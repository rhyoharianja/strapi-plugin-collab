import { describe, expect, it } from 'vitest';

import {
  LOCKABLE_TYPES,
  PRESENCE_FIELD,
  colorForUser,
  documentName,
  editorsOf,
  isPresenceRoom,
  lockOwner,
  shouldReleaseOnBlur,
  parseDocumentName,
  presenceRoom,
  type Presence,
} from './collab';

/**
 * Field locking has two failure modes that look nothing alike in code and identical on
 * screen, and both are silent:
 *
 * - a lock that applies to its own holder, so focusing a field disables the box you just
 *   clicked into;
 * - two browsers that each decide the *other* holds the field, so it is disabled for
 *   everyone and nobody can tell why.
 *
 * The second one is the reason this resolves deterministically rather than by arrival order.
 * Awareness is eventually consistent: for a moment either side can see both presences, and
 * if each picked "the other one" the field would deadlock.
 */

const presence = (userId: number, field: string | null, name = `User ${userId}`): Presence => ({
  userId,
  name,
  color: colorForUser(userId),
  cursor: null,
  field,
});

describe('lockOwner', () => {
  it('never locks a field against the person holding it', () => {
    expect(lockOwner([presence(1, 'title')], 'title', 1)).toBeNull();
  });

  it('locks a field held by someone else', () => {
    expect(lockOwner([presence(2, 'title')], 'title', 1)?.userId).toBe(2);
  });

  it('leaves other fields alone', () => {
    const others = [presence(2, 'title')];

    expect(lockOwner(others, 'slug', 1)).toBeNull();
  });

  it('ignores people who are present but not in any field', () => {
    expect(lockOwner([presence(2, null)], 'title', 1)).toBeNull();
  });

  it('resolves a contested field the same way in every browser', () => {
    /*
     * The deadlock case. Both users briefly see both presences; ordering by user id means
     * each independently names the same holder, so exactly one of them ends up disabled.
     */
    const contested = [presence(3, 'title'), presence(2, 'title')];

    expect(lockOwner(contested, 'title', 1)?.userId).toBe(2);
    expect(lockOwner(contested, 'title', 2)?.userId).toBe(3);
    expect(lockOwner(contested, 'title', 3)?.userId).toBe(2);
  });

  it('treats a field path as distinct from a bare name', () => {
    // Two components can each carry a `title`; they must not lock each other.
    const others = [presence(2, 'seo.title')];

    expect(lockOwner(others, 'title', 1)).toBeNull();
    expect(lockOwner(others, 'seo.title', 1)?.userId).toBe(2);
  });

  it('says nothing is locked in an empty room', () => {
    expect(lockOwner([], 'title', 1)).toBeNull();
  });
});

describe('editorsOf', () => {
  it('lists everyone else in the field, in a stable order', () => {
    const room = [presence(4, 'body'), presence(2, 'body'), presence(3, 'title')];

    expect(editorsOf(room, 'body', 1).map((p) => p.userId)).toEqual([2, 4]);
  });

  it('excludes you, so your own avatar never appears beside your own field', () => {
    expect(editorsOf([presence(1, 'body')], 'body', 1)).toEqual([]);
  });
});

describe('LOCKABLE_TYPES', () => {
  it('covers the plain scalar types and nothing the Content Manager draws itself', () => {
    /*
     * The boundary is what Strapi's generic `InputRenderer` can draw. Adding one of these
     * would mean rebuilding a picker the admin does not export.
     */
    for (const unsupported of [
      'relation',
      'media',
      'component',
      'dynamiczone',
      'richtext',
      'blocks',
    ]) {
      expect(LOCKABLE_TYPES).not.toContain(unsupported);
    }

    for (const supported of ['string', 'text', 'integer', 'boolean', 'datetime', 'enumeration']) {
      expect(LOCKABLE_TYPES).toContain(supported);
    }
  });
});

describe('room names', () => {
  it('round-trips a UID that itself contains colons', () => {
    // `::` would be the obvious separator and is wrong: a UID *is* `api::article.article`.
    const name = documentName('api::article.article', 'abc123', 'title');

    expect(parseDocumentName(name)).toEqual({
      uid: 'api::article.article',
      documentId: 'abc123',
      field: 'title',
    });
  });

  it('rejects a malformed name rather than guessing', () => {
    expect(parseDocumentName('api::article.article|abc123')).toBeNull();
    expect(parseDocumentName('')).toBeNull();
    expect(parseDocumentName('a|b|')).toBeNull();
  });

  it('marks the entry-level room, which stores nothing', () => {
    const room = presenceRoom('api::article.article', 'abc123');

    expect(parseDocumentName(room)?.field).toBe(PRESENCE_FIELD);
    expect(isPresenceRoom(PRESENCE_FIELD)).toBe(true);
    expect(isPresenceRoom('title')).toBe(false);
  });
});

describe('colorForUser', () => {
  it('gives the same person the same colour everywhere', () => {
    // A cursor whose colour changes per viewer is worse than no colour at all.
    expect(colorForUser(7)).toBe(colorForUser(7));
  });

  it('handles a negative id rather than reading off the end of the palette', () => {
    expect(colorForUser(-3)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('shouldReleaseOnBlur', () => {
  // Plain objects: the rule is structural, so it needs no DOM to be exercised.
  const inner = { id: 'inner' };
  const outside = { id: 'outside' };
  const wrapper = (holds: object[]) => ({ contains: (node: object) => holds.includes(node) });

  it('keeps the lock while focus moves inside the same field', () => {
    /*
     * The bug this exists to prevent. A Strapi input hops focus between its own elements —
     * a wrapper, then the real input; a select's trigger, then its listbox — and each hop
     * fires a blur. Releasing on those meant the lock never survived long enough for a peer
     * to see it, and the field stayed editable for everyone.
     */
    expect(shouldReleaseOnBlur(inner, wrapper([inner]))).toBe(false);
  });

  it('releases when focus lands on something else entirely', () => {
    expect(shouldReleaseOnBlur(outside, wrapper([inner]))).toBe(true);
  });

  it('keeps the lock when focus leaves the document', () => {
    // Switching windows is not moving away from the field, and closing the tab drops the
    // awareness state anyway — which releases it for real.
    expect(shouldReleaseOnBlur(null, wrapper([inner]))).toBe(false);
  });
});
