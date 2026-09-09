/** Contract shared by this plugin's server and admin bundles. */

export const PLUGIN_ID = 'content-hub-collab' as const;

/** WebSocket path the provider connects to, on Strapi's own port. */
export const SOCKET_PATH = '/content-hub-collab' as const;

/**
 * Name of the shared Yjs document.
 *
 * One CRDT per **field of one entry**, not per entry: two people editing different fields
 * of the same article should not contend, and a smaller document is cheaper to sync and to
 * persist.
 *
 * Separated by `|`, which cannot appear in a content-type UID, a document id or a field
 * name. `::` would be the obvious choice and is wrong: a UID *is* `api::article.article`,
 * so splitting on it yields four parts, not three.
 */
export const SEPARATOR = '|' as const;

export const documentName = (uid: string, documentId: string, field: string): string =>
  [uid, documentId, field].join(SEPARATOR);

export const parseDocumentName = (
  name: string
): { uid: string; documentId: string; field: string } | null => {
  const parts = name.split(SEPARATOR);
  if (parts.length !== 3) return null;

  const [uid, documentId, field] = parts;
  if (!uid || !documentId || !field) return null;

  return { uid, documentId, field };
};

/** The Y.Text key inside the shared document. */
export const TEXT_KEY = 'content' as const;

/**
 * Field name for an entry-level **presence** room.
 *
 * Presence answers "who else has this entry open?", which is useful on every content-type —
 * not only ones carrying a collaborative field. Such a room stores nothing: it exists purely
 * to exchange awareness, so the server skips both seeding and persistence for it.
 */
export const PRESENCE_FIELD = '__presence' as const;

export const presenceRoom = (uid: string, documentId: string): string =>
  documentName(uid, documentId, PRESENCE_FIELD);

export const isPresenceRoom = (field: string): boolean => field === PRESENCE_FIELD;

/** What each connected editor broadcasts through Yjs awareness. */
export interface Presence {
  userId: number;
  name: string;
  /** Stable colour derived from the user id, so a person looks the same to everyone. */
  color: string;
  /** Caret position, or null when the field is not focused. */
  cursor: { anchor: number; head: number } | null;
  /**
   * The field this person currently has focus in, or null.
   *
   * The whole locking model rests on this one value. It is broadcast through Yjs awareness,
   * which is **ephemeral by construction**: it is dropped when the tab closes, the network
   * drops or the socket times out. That is what makes "locked fields automatically unlock
   * when users move away" true without anything having to notice a departure — there is no
   * lock record to leave behind, only a presence that stopped being there.
   *
   * A path, not a name: a field inside a component reports `seo.title`, so two components
   * carrying a field of the same name do not lock each other.
   */
  field?: string | null;
}

/**
 * Who else is holding `field`, if anyone.
 *
 * Returns the *other* person, never you: focusing a field must not disable it for the person
 * who just focused it. First one wins when several are somehow present, which can happen for
 * a moment because awareness is eventually consistent — two people can both believe they
 * hold a field until their states cross. Ordering by user id makes that moment resolve the
 * same way in both browsers instead of each disabling the other.
 */
export const lockOwner = (
  presences: Presence[],
  field: string,
  myUserId: number
): Presence | null => {
  const holders = presences
    .filter((presence) => presence.userId !== myUserId && presence.field === field)
    .sort((a, b) => a.userId - b.userId);

  return holders[0] ?? null;
};

/** Everyone other than you with focus in `field`, for the avatars shown beside it. */
export const editorsOf = (
  presences: Presence[],
  field: string,
  myUserId: number
): Presence[] =>
  presences
    .filter((presence) => presence.userId !== myUserId && presence.field === field)
    .sort((a, b) => a.userId - b.userId);

/**
 * Whether a blur means the editor has really left the field.
 *
 * Extracted and tested because getting it wrong is invisible. Releasing on every blur looks
 * correct and is not: a Strapi input moves focus between its own inner elements — a wrapper
 * and then the real input, a select's trigger and then its listbox — and each hop fires a
 * blur for the element being left. Release on those and the lock is claimed and dropped
 * within milliseconds, so no peer ever sees it held and the field stays editable for
 * everyone, with nothing in any log to explain it.
 *
 * `next` is the element *receiving* focus. Null means focus left the document entirely —
 * another window, or the browser itself losing focus — which is not the same as moving away
 * from the field, so the lock is kept. Closing the tab drops the awareness state and
 * releases it for real.
 *
 * Typed structurally rather than against `Node`, because this module is compiled for the
 * **server** as well and that build has no DOM library — naming `Node` here fails it. It
 * also means the rule can be exercised without a DOM.
 */
export interface ContainerLike<T> {
  contains: (node: T) => boolean;
}

export const shouldReleaseOnBlur = <T>(
  next: T | null | undefined,
  wrapper: ContainerLike<T>
): boolean => {
  if (!next) return false;

  return !wrapper.contains(next);
};

/**
 * Field types a lock can be applied to.
 *
 * Bounded by what can be *delegated*: the wrapper renders Strapi's own generic
 * `InputRenderer`, and that renderer is a plain switch over exactly these types. A relation,
 * media, component, dynamic zone, rich text or blocks field is drawn by the Content Manager
 * itself with components it does not export, so wrapping one would mean reimplementing it —
 * and a half-reimplemented relation picker is a worse outcome than an unlocked field.
 */
export const LOCKABLE_TYPES = [
  'biginteger',
  'boolean',
  'date',
  'datetime',
  'decimal',
  'email',
  'enumeration',
  'float',
  'integer',
  'json',
  'password',
  'string',
  'text',
  'time',
  'timestamp',
  'uid',
] as const;

export type LockableType = (typeof LOCKABLE_TYPES)[number];

/**
 * Presence colours.
 *
 * Picked by user id rather than at random so the same person is the same colour in every
 * browser — a cursor whose colour changes per viewer is worse than no colour at all.
 */
export const PRESENCE_COLORS = [
  '#4945ff',
  '#d9822b',
  '#328048',
  '#c0392b',
  '#8e44ad',
  '#0f7b9f',
  '#b8860b',
  '#c2185b',
] as const;

export const colorForUser = (userId: number): string =>
  PRESENCE_COLORS[Math.abs(userId) % PRESENCE_COLORS.length]!;

export interface CollabConfig {
  /** Content-type UIDs allowed to open a collaborative session. Empty = all. */
  contentTypes: string[];
  /** Seconds of quiet before the CRDT is committed back to the entry. */
  debounceSeconds: number;
  /** Whether a Redis adapter is configured for horizontal scale. */
  redis: boolean;
}
