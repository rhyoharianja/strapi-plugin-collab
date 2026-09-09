import { beforeEach, describe, expect, it, vi } from "vitest";

import { colorForUser, type Presence } from "../../../shared/collab";
import {
  clearSession,
  getSession,
  publishSession,
  subscribeSession,
} from "./store";

/**
 * The store sits between one WebSocket and every field on the page, so what matters is how
 * often it says something changed. Awareness fires on a heartbeat; a store that notified on
 * each one would re-render every input in the form several times a second, and typing in a
 * long entry would stutter for reasons nobody could see.
 */

const presence = (userId: number, field: string | null): Presence => ({
  userId,
  name: `User ${userId}`,
  color: colorForUser(userId),
  cursor: null,
  field,
});

beforeEach(() => {
  clearSession();
});

describe("publishSession", () => {
  it("caches the snapshot, which useSyncExternalStore requires", () => {
    publishSession({ key: "room", presences: [presence(2, "title")], myUserId: 1 });

    // A fresh object per call makes React warn and re-render in a loop.
    expect(getSession()).toBe(getSession());
  });

  it("notifies when someone takes a field", () => {
    const listener = vi.fn();
    subscribeSession(listener);

    publishSession({ key: "room", presences: [presence(2, null)], myUserId: 1 });
    expect(listener).toHaveBeenCalledTimes(1);

    publishSession({ key: "room", presences: [presence(2, "title")], myUserId: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("says nothing changed for an identical heartbeat", () => {
    const state = { key: "room", presences: [presence(2, "title")], myUserId: 1 };
    publishSession(state);

    const listener = vi.fn();
    subscribeSession(listener);

    // A new array holding equal presences — which is what arrives on every awareness tick.
    publishSession({ key: "room", presences: [presence(2, "title")], myUserId: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("notices someone arriving and someone leaving", () => {
    publishSession({ key: "room", presences: [presence(2, "title")], myUserId: 1 });

    const listener = vi.fn();
    subscribeSession(listener);

    publishSession({
      key: "room",
      presences: [presence(2, "title"), presence(3, null)],
      myUserId: 1,
    });
    expect(listener).toHaveBeenCalledTimes(1);

    publishSession({ key: "room", presences: [presence(2, "title")], myUserId: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("notices a different entry, so one room cannot leak into the next", () => {
    publishSession({ key: "room-a", presences: [presence(2, "title")], myUserId: 1 });

    const listener = vi.fn();
    subscribeSession(listener);

    publishSession({ key: "room-b", presences: [presence(2, "title")], myUserId: 1 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSession().key).toBe("room-b");
  });
});

describe("clearSession", () => {
  it("empties the room and notifies once", () => {
    publishSession({ key: "room", presences: [presence(2, "title")], myUserId: 1 });

    const listener = vi.fn();
    subscribeSession(listener);

    clearSession();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSession().presences).toEqual([]);
    expect(getSession().key).toBeNull();
  });

  it("is quiet when there was nothing to clear", () => {
    const listener = vi.fn();
    subscribeSession(listener);

    clearSession();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("unsubscribing", () => {
  it("stops delivering", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSession(listener);

    unsubscribe();
    publishSession({ key: "room", presences: [presence(2, "title")], myUserId: 1 });

    expect(listener).not.toHaveBeenCalled();
  });
});
