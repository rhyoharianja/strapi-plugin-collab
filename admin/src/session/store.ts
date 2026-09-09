import type { Presence } from "../../../shared/collab";

/**
 * The live editing session for the entry currently open, outside React.
 *
 * **Why a module store rather than context.** The field wrappers are rendered by the Content
 * Manager, from a component registered through `addFields` — they appear deep inside its
 * tree with no ancestor of ours anywhere above them. The component that owns the WebSocket
 * is injected into a different part of that same tree. The two have no common provider we
 * control, so React context cannot join them; a module-level store is what makes a field
 * wrapper able to see who else is in the room.
 *
 * Everything here is ephemeral and per-entry. Nothing is persisted, and nothing survives the
 * entry being closed — which is the point: a lock is a presence, not a record, so there is
 * never a stale lock to clean up.
 */

export interface SessionState {
  /** The entry this session belongs to, so a stale store cannot leak into another entry. */
  key: string | null;
  /** Everyone in the room, including you. */
  presences: Presence[];
  myUserId: number;
}

const EMPTY: SessionState = { key: null, presences: [], myUserId: 0 };

let state: SessionState = EMPTY;

const listeners = new Set<() => void>();

/**
 * Claim and release, set by the session bridge once it is connected.
 *
 * Kept off the snapshot: their identity changes whenever the provider reconnects, and a
 * subscriber that re-rendered for that would re-render every field on every reconnect.
 */
const NOOP_CLAIM = (_field: string): void => {};
const NOOP_RELEASE = (_field: string): void => {};

export const sessionActions = {
  claim: NOOP_CLAIM,
  release: NOOP_RELEASE,
};

const notify = () => {
  for (const listener of listeners) listener();
};

/** Same presences, same order, same fields — so a heartbeat does not re-render every field. */
const sameAs = (next: SessionState): boolean => {
  if (next.key !== state.key || next.myUserId !== state.myUserId) return false;
  if (next.presences.length !== state.presences.length) return false;

  return next.presences.every((presence, index) => {
    const previous = state.presences[index];

    return (
      previous !== undefined &&
      previous.userId === presence.userId &&
      previous.field === presence.field &&
      previous.name === presence.name &&
      previous.color === presence.color
    );
  });
};

export const publishSession = (next: SessionState): void => {
  if (sameAs(next)) return;

  state = next;
  notify();
};

/** Forget the session, on leaving the entry or losing the connection. */
export const clearSession = (): void => {
  if (state === EMPTY) return;

  state = EMPTY;
  sessionActions.claim = NOOP_CLAIM;
  sessionActions.release = NOOP_RELEASE;
  notify();
};

export const subscribeSession = (listener: () => void): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

/**
 * `useSyncExternalStore` needs a cached snapshot: a fresh object per call makes React warn
 * and re-render in a loop. `state` is only ever replaced in `publishSession`.
 */
export const getSession = (): SessionState => state;
