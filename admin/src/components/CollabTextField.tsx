import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Box, Field, Flex, Typography } from "@strapi/design-system";
import { useAuth, useField } from "@strapi/strapi/admin";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useParams } from "react-router-dom";
import * as Y from "yjs";

import {
  SOCKET_PATH,
  TEXT_KEY,
  colorForUser,
  documentName,
  type Presence,
} from "../../../shared/collab";

interface CollabFieldProps {
  name: string;
  label?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  value?: unknown;
  onChange?: (eventOrPath: string, value?: unknown) => void;
  error?: string;
}

/**
 * A text field edited by several people at once.
 *
 * The CRDT is the live truth while a session is open; the form value is kept in step so the
 * entry's own Save button still writes something sensible, and the server commits the CRDT
 * on its own debounce. Two write paths sound redundant, but a collaborator who never presses
 * Save must still not lose work — and an editor who does press Save must not save a stale
 * value they can see is out of date on screen.
 */
const CollabTextField = ({
  name,
  label,
  hint,
  required,
  disabled,
  value: valueProp,
  onChange: onChangeProp,
  error: errorProp,
}: CollabFieldProps) => {
  const field = useField<unknown>(name);
  const { slug, id } = useParams<{ slug: string; id: string }>();

  // Who the peers will see. Read from Strapi's auth context rather than the token, so the
  // name shown is the one the panel itself displays.
  // The third argument is required for the runtime to match the types: without it, a
  // missing context silently yields `undefined`. See docs/package-conventions.md.
  const me = useAuth("CollabTextField", (auth) => auth.user, true);

  /*
   * The token from the Auth context, not from storage.
   *
   * Reading `jwtToken` out of `localStorage`/`sessionStorage` by hand only works when
   * "remember me" persisted it; otherwise Strapi 5 keeps it in memory behind an httpOnly
   * cookie, so the read returned an empty string, the socket was rejected, and the field
   * quietly stopped collaborating while still looking fine.
   */
  const token = useAuth("CollabTextField", (auth) => auth.token, true);

  const identity = useMemo<Presence>(
    () => ({
      // Strapi types a user id as `ID` (string | number); the presence colour needs a number.
      userId: Number(me?.id ?? 0),
      name:
        [me?.firstname, me?.lastname].filter(Boolean).join(" ") || me?.email || "Someone",
      color: colorForUser(Number(me?.id ?? 0)),
      cursor: null,
    }),
    [me]
  );

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const applyingRemote = useRef(false);

  const [text, setText] = useState<string>(
    typeof (valueProp ?? field.value) === "string" ? String(valueProp ?? field.value) : ""
  );
  const [peers, setPeers] = useState<Presence[]>([]);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">(
    "connecting"
  );
  const [readOnly, setReadOnly] = useState(false);

  const commit = onChangeProp ?? field.onChange;
  const error = errorProp ?? field.error;

  const room = useMemo(
    () => (slug && id ? documentName(slug, id, name) : null),
    [slug, id, name]
  );

  useEffect(() => {
    // A brand-new entry has no document id, so there is nothing to share yet: the field
    // behaves as a plain textarea until the entry has been saved once.
    if (!room) return undefined;

    // Without a token the socket is rejected outright; wait for the auth context.
    if (!token) return undefined;

    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${SOCKET_PATH}`,
      name: room,
      document: ydoc,
      token,
      onStatus: ({ status: next }) => setStatus(next === "connected" ? "connected" : "connecting"),
      onDisconnect: () => setStatus("disconnected"),
      onAuthenticationFailed: () => {
        // The server refuses a session the role may not write; degrade to read-only rather
        // than leaving the editor staring at a dead field.
        setReadOnly(true);
        setStatus("disconnected");
      },
    });

    providerRef.current = provider;

    const ytext = ydoc.getText(TEXT_KEY);

    const syncFromCrdt = () => {
      const next = ytext.toString();
      applyingRemote.current = true;
      setText(next);
      commit(name, next);
      applyingRemote.current = false;
    };

    ytext.observe(syncFromCrdt);

    provider.on("synced", syncFromCrdt);

    provider.setAwarenessField("user", identity);

    const onAwareness = () => {
      const states = [...provider.awareness!.getStates().entries()]
        .filter(([clientId]) => clientId !== provider.awareness!.clientID)
        .map(([, state]) => (state as { user?: Presence }).user)
        .filter((entry): entry is Presence => Boolean(entry?.name));

      setPeers(states);
    };

    provider.awareness?.on("change", onAwareness);

    return () => {
      ytext.unobserve(syncFromCrdt);
      provider.awareness?.off("change", onAwareness);
      provider.destroy();
      providerRef.current = null;
      ydoc.destroy();
    };
    // `commit` is intentionally excluded: it changes identity on every render, and
    // re-creating the provider per keystroke would drop the session constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, name, identity, token]);

  /** Local typing → CRDT. Replaces the whole text; Yjs diffs it into minimal operations. */
  const onType = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value;
      setText(next);
      commit(name, next);

      const provider = providerRef.current;
      if (!provider || applyingRemote.current) return;

      const ytext = provider.document.getText(TEXT_KEY);

      ytext.doc?.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, next);
      });
    },
    [commit, name]
  );

  const broadcastCursor = useCallback(() => {
    const provider = providerRef.current;
    const element = textareaRef.current;
    if (!provider || !element) return;

    provider.setAwarenessField("user", {
      ...identity,
      cursor: { anchor: element.selectionStart, head: element.selectionEnd },
    } satisfies Presence);
  }, [identity]);

  const statusColour =
    status === "connected" ? "success600" : status === "connecting" ? "warning600" : "neutral500";

  return (
    <Field.Root name={name} error={error} hint={hint} required={required}>
      <Flex justifyContent="space-between" alignItems="center">
        <Field.Label>{label ?? name}</Field.Label>

        <Flex gap={2} alignItems="center">
          {peers.map((peer) => (
            <Badge
              key={`${peer.userId}-${peer.name}`}
              style={{ background: peer.color, color: "#ffffff", border: "none" }}
              title={
                peer.cursor
                  ? `${peer.name} — caret at ${peer.cursor.head}`
                  : `${peer.name} — viewing`
              }
            >
              {peer.name}
            </Badge>
          ))}
          <Typography variant="pi" textColor={statusColour}>
            {room ? status : "save the entry to collaborate"}
            {readOnly ? " · read-only" : ""}
          </Typography>
        </Flex>
      </Flex>

      <textarea
        ref={textareaRef}
        name={name}
        value={text}
        disabled={disabled || readOnly}
        onChange={onType}
        onSelect={broadcastCursor}
        onKeyUp={broadcastCursor}
        onClick={broadcastCursor}
        rows={10}
        style={{
          width: "100%",
          padding: 12,
          borderRadius: 4,
          border: "1px solid var(--neutral200, #dcdce4)",
          background: readOnly ? "var(--neutral100, #f6f6f9)" : "var(--neutral0, #ffffff)",
          color: "var(--neutral800, #32324d)",
          fontFamily: "inherit",
          fontSize: 14,
          lineHeight: 1.6,
          resize: "vertical",
        }}
      />

      <Box paddingTop={1}>
        <Typography variant="pi" textColor="neutral500">
          {peers.length === 0
            ? "No one else is editing this field."
            : `${peers.length} other editor${peers.length === 1 ? "" : "s"} in this field.`}
        </Typography>
      </Box>

      <Field.Hint />
      <Field.Error />
    </Field.Root>
  );
};

export { CollabTextField };
export default CollabTextField;
