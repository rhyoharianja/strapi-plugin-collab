import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import type { Core } from '@strapi/strapi';
import { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer, type WebSocket } from 'ws';

import {
  PLUGIN_ID,
  SOCKET_PATH,
  TEXT_KEY,
  isPresenceRoom,
  parseDocumentName,
  type CollabConfig,
} from '../../../shared/collab';
import { documents } from '../utils/documents';

/** An admin user resolved from the token a client presents on connect. */
interface CollabContext {
  userId: number;
  name: string;
  /** Set when the user may read the field but not write it. */
  readOnly: boolean;
}

/**
 * The collaboration server.
 *
 * Hocuspocus runs **in-process**, attached to Strapi's own HTTP server through its
 * `upgrade` event with `noServer: true`. One process, one port, nothing extra to deploy —
 * and the WebSocket handshake carries the same cookies and origin as the admin panel.
 */
const collab = ({ strapi }: { strapi: Core.Strapi }) => {
  let wss: WebSocketServer | null = null;
  let hocuspocus: Hocuspocus | null = null;

  const config = (): CollabConfig => ({
    contentTypes: strapi.config.get(`plugin::${PLUGIN_ID}.contentTypes`, []) as string[],
    debounceSeconds: strapi.config.get(`plugin::${PLUGIN_ID}.debounceSeconds`, 2) as number,
    redis: Boolean(process.env.COLLAB_REDIS_HOST),
  });

  /**
   * Resolve the admin user behind a connection token.
   *
   * Verified by asking Strapi's own `/admin/users/me`, rather than decoding the JWT here.
   * The admin token format is internal and moved to session tokens in 5.52 — the helper
   * that used to decode it no longer exists — whereas that endpoint is the stable contract
   * and always agrees with however the panel is currently authenticating.
   */
  const authenticate = async (token: string): Promise<CollabContext | null> => {
    if (!token) return null;

    const port = strapi.config.get('server.port', 1337);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/admin/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) return null;

      const payload = (await response.json()) as {
        data?: { id: number; firstname?: string; lastname?: string; email?: string };
      };

      const user = payload.data;
      if (!user?.id) return null;

      return {
        userId: user.id,
        name:
          [user.firstname, user.lastname].filter(Boolean).join(' ') ||
          user.email ||
          `User ${user.id}`,
        readOnly: false,
      };
    } catch {
      return null;
    }
  };

  return {
    config,

    /**
     * Boot the server and hook it onto Strapi's HTTP server.
     *
     * Idempotent, because Strapi's dev server re-runs `bootstrap` on reload and a second
     * listener would double every message.
     */
    async start(): Promise<void> {
      if (hocuspocus) return;

      const settings = config();

      hocuspocus = new Hocuspocus({
        name: 'content-hub-collab',

        // Commit only after the typing stops. Persisting on every keystroke would write to
        // Postgres dozens of times a second per editor.
        debounce: settings.debounceSeconds * 1000,
        maxDebounce: Math.max(settings.debounceSeconds * 5, 10) * 1000,

        /**
         * Authorise the *session*, not each keystroke.
         *
         * This is the only place field-level permission can be enforced for collaborative
         * editing: the eventual write happens outside any HTTP request, so the field-RBAC
         * middleware sees no acting user and treats it as a system write. Refusing the
         * connection here is what keeps that from becoming a hole.
         */
        async onAuthenticate(data) {
          const refuse = (reason: string): never => {
            strapi.log.warn(`[${PLUGIN_ID}] refused ${data.documentName}: ${reason}`);
            throw new Error(reason);
          };

          const parsed = parseDocumentName(data.documentName);

          if (!parsed) return refuse(`Malformed document name "${data.documentName}"`);

          /*
           * The opt-in list gates *editing*, not presence. Seeing who else has an entry
           * open is useful on every content-type and stores nothing, so a presence room is
           * always allowed — and needs no field permission either.
           */
          if (
            !isPresenceRoom(parsed.field) &&
            settings.contentTypes.length > 0 &&
            !settings.contentTypes.includes(parsed.uid)
          ) {
            return refuse(`Collaboration is not enabled for ${parsed.uid}`);
          }

          const context = await authenticate(data.token);

          if (!context) {
            return refuse(
              data.token ? 'Token rejected by /admin/users/me' : 'No token presented'
            );
          }

          const rbac = isPresenceRoom(parsed.field)
            ? null
            : strapi.plugin('content-hub-field-rbac');

          try {
            if (rbac) {
              const user = await strapi.db
              .query('admin::user')
                .findOne({ where: { id: context.userId }, populate: ['roles'] });

              /*
               * The owning plugin answers this, rather than collab evaluating the rules with a
               * shared helper. One implementation, one answer: if the two ever disagreed, a
               * session would accept typing into a field whose write is refused on save.
               */
              const denied: string[] = await rbac.service('rules').deniedFieldsFor(
                {
                  id: context.userId,
                  roles: (user?.roles ?? []).map((r: { code: string }) => r.code),
                },
                parsed.uid,
                [parsed.field],
                'write'
              );

              if (denied.length > 0) {
                // Joining read-only beats a hard refusal: the editor still sees the live
                // document and who else is in it, they just cannot type into it.
                context.readOnly = true;
                data.connectionConfig.readOnly = true;
              }
            }
          } catch (error) {
            // A permission lookup that fails must not silently become a refusal to
            // collaborate; log it and let the session through as writable.
            strapi.log.warn(
              `[${PLUGIN_ID}] field permission lookup failed: ${(error as Error).message}`
            );
          }

          strapi.log.debug(
            `[${PLUGIN_ID}] ${context.name} joined ${data.documentName}` +
              (context.readOnly ? ' (read-only)' : '')
          );

          return context;
        },

        /** Seed the CRDT from the stored value the first time a document is opened. */
        async onLoadDocument(data) {
          const parsed = parseDocumentName(data.documentName);
          if (!parsed) return data.document;

          // A presence room carries no content; there is nothing to seed.
          if (isPresenceRoom(parsed.field)) return data.document;

          const text = data.document.getText(TEXT_KEY);

          // Only seed an empty document: once a session is live the CRDT is the truth, and
          // re-seeding would duplicate everything typed so far.
          if (text.length > 0) return data.document;

          const entry = await documents(strapi, parsed.uid).findFirst({
            filters: { documentId: parsed.documentId },
          });

          const stored = entry?.[parsed.field];

          if (typeof stored === 'string' && stored.length > 0) {
            text.insert(0, stored);
          }

          return data.document;
        },

        /** Commit the CRDT back to the entry, debounced. */
        async onStoreDocument(data) {
          const parsed = parseDocumentName(data.documentName);
          if (!parsed) return;

          // Presence is ephemeral: writing `__presence` onto the entry would be nonsense.
          if (isPresenceRoom(parsed.field)) return;

          const value = data.document.getText(TEXT_KEY).toString();

          /*
           * Written through the Document Service with no request context, so it is a system
           * write — which is exactly why `onAuthenticate` above had to do the permission
           * check. It also means the write triggers content flows normally.
           */
          await documents(strapi, parsed.uid).update({
            documentId: parsed.documentId,
            data: { [parsed.field]: value },
          });

          strapi.log.debug(
            `[${PLUGIN_ID}] stored ${parsed.uid}/${parsed.documentId}.${parsed.field} ` +
              `(${value.length} chars, ${data.clientsCount} client(s))`
          );
        },
      });

      wss = new WebSocketServer({ noServer: true });

      const httpServer = (strapi.server as unknown as { httpServer: NodeJS.EventEmitter })
        .httpServer;

      httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        // Strapi's admin and any other consumer share this port, so only claim our path.
        const origin = `http://${request.headers.host ?? 'localhost'}`;
        const { pathname } = new URL(request.url ?? '', origin);

        if (pathname !== SOCKET_PATH) return;

        wss!.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          /*
           * Hocuspocus 4 moved to crossws and takes a **web** `Request`, not Node's
           * `IncomingMessage`. Rebuilding one keeps the query string and headers it reads
           * (the token among them) intact.
           */
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers)) {
            if (typeof value === 'string') headers.set(key, value);
            else if (Array.isArray(value)) headers.set(key, value.join(', '));
          }

          const webRequest = new Request(`${origin}${request.url ?? ''}`, { headers });

          const connection = hocuspocus!.handleConnection(ws as never, webRequest);

          /*
           * Hocuspocus 4 no longer listens on the socket itself — its crossws adapter feeds
           * the connection. Attaching to a raw `ws` socket therefore means pumping messages
           * across by hand; without this the handshake succeeds and then nothing ever
           * syncs, which looks exactly like a silent connection failure.
           */
          ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
            const buffer = Array.isArray(data)
              ? Buffer.concat(data)
              : Buffer.isBuffer(data)
                ? data
                : Buffer.from(data);

            connection.handleMessage(new Uint8Array(buffer));
          });

          ws.on('close', () => connection.handleClose());
        });
      });

      strapi.log.info(
        `[${PLUGIN_ID}] collaboration server listening on ${SOCKET_PATH} ` +
          `(debounce ${settings.debounceSeconds}s${settings.redis ? ', redis' : ''})`
      );
    },

    async stop(): Promise<void> {
      // Flush before closing: a debounced commit still pending would otherwise be lost, and
      // the dev server reloads often enough for that to cost real work.
      hocuspocus?.flushPendingStores();
      hocuspocus?.closeConnections();
      wss?.close();
      hocuspocus = null;
      wss = null;
    },

    /** Exposed for the admin page: which documents are live and how many editors are in them. */
    sessions(): Array<{ documentName: string; clients: number }> {
      if (!hocuspocus) return [];

      return [...hocuspocus.documents.entries()].map(([documentName, document]) => ({
        documentName,
        clients: document.getConnectionsCount(),
      }));
    },
  };
};

export default collab;
