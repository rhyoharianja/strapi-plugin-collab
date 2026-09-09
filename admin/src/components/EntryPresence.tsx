import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Flex, Tooltip, Typography } from '@strapi/design-system';
import { useAuth } from '@strapi/strapi/admin';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useParams } from 'react-router-dom';
import * as Y from 'yjs';

import { SOCKET_PATH, colorForUser, presenceRoom, type Presence } from '../../../shared/collab';
import { clearSession, publishSession, sessionActions } from '../session/store';

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '?';

/**
 * The entry's editing session: who else is here, and who is holding which field.
 *
 * Injected into every Content Manager edit view, so it works on **any** content-type rather
 * than only ones carrying a collaborative field — "am I about to collide with someone?"
 * applies to an ordinary Article just as much.
 *
 * It owns the only WebSocket for the entry and pumps what arrives into a module store, which
 * is what the field wrappers read. They are rendered by the Content Manager, deep in its
 * tree, with no ancestor of ours above them; there is no provider we could share with them.
 *
 * The room stores nothing. It exists purely to exchange Yjs awareness, so the server skips
 * seeding and persistence for it — and because awareness is dropped when a tab closes or a
 * socket times out, a lock cannot outlive the person holding it. There is no lock record to
 * clean up.
 */
const EntryPresence = () => {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  // The third argument is required for the runtime to match the types: without it, a
  // missing context silently yields `undefined`. See docs/package-conventions.md.
  const me = useAuth('EntryPresence', (auth) => auth.user, true);

  /*
   * The token from the Auth context, not from storage.
   *
   * This used to read `jwtToken` out of `localStorage`/`sessionStorage` by hand. Strapi 5
   * only persists the token there when "remember me" was used; otherwise it lives in memory
   * behind an httpOnly cookie, so the hand-rolled read returned an empty string, the socket
   * was rejected, and collaboration silently did nothing at all.
   */
  const token = useAuth('EntryPresence', (auth) => auth.token, true);

  const [peers, setPeers] = useState<Presence[]>([]);

  /** The field this browser currently holds, kept in a ref so claiming never re-renders. */
  const heldField = useRef<string | null>(null);

  const identity = useMemo(
    () => ({
      userId: Number(me?.id ?? 0),
      name: [me?.firstname, me?.lastname].filter(Boolean).join(' ') || me?.email || 'Someone',
      color: colorForUser(Number(me?.id ?? 0)),
      cursor: null,
    }),
    [me]
  );

  useEffect(() => {
    // A brand-new entry has no document id, so nobody else can be in it yet.
    if (!slug || !id || !token) return undefined;

    const key = presenceRoom(slug, id);

    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${SOCKET_PATH}`,
      name: key,
      document: ydoc,
      token,
    });

    const broadcast = () => {
      provider.setAwarenessField('user', { ...identity, field: heldField.current });
    };

    broadcast();

    /*
     * Claiming is a broadcast, not a request. Nobody grants a lock: each browser says which
     * field it is in, and every other browser decides for itself what that means. A server
     * that had to approve a claim would put a round trip between clicking a field and being
     * allowed to type in it.
     */
    sessionActions.claim = (field: string) => {
      if (heldField.current === field) return;

      heldField.current = field;
      broadcast();
    };

    sessionActions.release = (field: string) => {
      // Only if it is still the field we hold: a blur can arrive after the next field's
      // focus, and clearing then would release a lock we had just taken.
      if (heldField.current !== field) return;

      heldField.current = null;
      broadcast();
    };

    const onChange = () => {
      const states = [...(provider.awareness?.getStates().entries() ?? [])]
        .filter(([clientId]) => clientId !== provider.awareness?.clientID)
        .map(([, state]) => (state as { user?: Presence }).user)
        .filter((entry): entry is Presence => Boolean(entry?.name));

      /*
       * One entry per person, not per tab — the same editor with two tabs open is still one
       * person to collide with. The tab actually holding a field wins, so a second idle tab
       * cannot mask a real lock.
       */
      const unique = new Map<number, Presence>();

      for (const entry of states) {
        const existing = unique.get(entry.userId);

        if (!existing || (!existing.field && entry.field)) unique.set(entry.userId, entry);
      }

      const presences = [...unique.values()];

      setPeers(presences);
      publishSession({ key, presences, myUserId: identity.userId });
    };

    provider.awareness?.on('change', onChange);

    return () => {
      provider.awareness?.off('change', onChange);
      provider.destroy();
      ydoc.destroy();
      heldField.current = null;
      // Leaving the entry must not leave a stale room behind for the next one.
      clearSession();
    };
  }, [slug, id, token, identity]);

  // Nothing to say when nobody else is here.
  if (peers.length === 0) return null;

  return (
    <Box paddingTop={2} paddingBottom={2}>
      <Typography variant="sigma" textColor="neutral600">
        Also editing
      </Typography>

      <Flex gap={1} paddingTop={2} wrap="wrap">
        {peers.map((peer) => (
          <Tooltip
            key={peer.userId}
            label={
              peer.field
                ? `${peer.name} is editing ${peer.field}`
                : `${peer.name} has this entry open`
            }
          >
            <div
              aria-label={peer.name}
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: peer.color,
                color: '#ffffff',
                display: 'grid',
                placeItems: 'center',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.3,
                // A ring so overlapping avatars stay legible on any background.
                boxShadow: '0 0 0 2px var(--neutral0, #ffffff)',
                cursor: 'default',
                userSelect: 'none',
              }}
            >
              {initialsOf(peer.name)}
            </div>
          </Tooltip>
        ))}
      </Flex>
    </Box>
  );
};

export { EntryPresence, initialsOf };
