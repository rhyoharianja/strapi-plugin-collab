import * as React from "react";
import { Flex, Tooltip, Typography } from "@strapi/design-system";
import { InputRenderer } from "@strapi/strapi/admin";

import { lockOwner, shouldReleaseOnBlur, type Presence } from "../../../shared/collab";
import { getSession, sessionActions, subscribeSession } from "../session/store";
import { initialsOf } from "./EntryPresence";

/**
 * A field that disables itself while someone else is editing it.
 *
 * Registered through `addFields` for each plain scalar type, which the Content Manager
 * consults *before* its own switch — the same mechanism the upload plugin uses to own the
 * `media` input. So this component stands in front of every string, number, date, boolean,
 * enumeration and JSON field in the panel.
 *
 * **It does not reimplement anything.** It delegates to Strapi's own `InputRenderer`, the
 * exact component the Content Manager would have rendered, and only adds two things: a
 * `disabled` when someone else holds the field, and an avatar saying who. That is why the
 * type list is bounded — see `LOCKABLE_TYPES`. A relation, media, component, dynamic zone,
 * rich text or blocks field is drawn by the Content Manager with components it does not
 * export, so wrapping one would mean rebuilding it, and a half-rebuilt relation picker is a
 * worse outcome than an unlocked field.
 *
 * **Locking is advisory, and worth being honest about.** It stops two people typing into the
 * same box at once, which is the collision that actually happens. It is not a transaction:
 * the entry is still saved as a whole, so two people editing *different* fields still race
 * on save, and whoever saves last wins. Preventing that needs per-field persistence, which
 * Strapi does not do.
 */

/** Everything the Content Manager hands a field input, plus what it adds for enumerations. */
type FieldProps = React.ComponentProps<typeof InputRenderer> & {
  name: string;
  disabled?: boolean;
};

const useLockOwner = (field: string): Presence | null => {
  const session = React.useSyncExternalStore(subscribeSession, getSession);

  return React.useMemo(
    () => lockOwner(session.presences, field, session.myUserId),
    [session, field]
  );
};

const HolderBadge = ({ holder }: { holder: Presence }) => (
  <Tooltip label={`${holder.name} is editing this field`}>
    <span
      aria-label={`${holder.name} is editing this field`}
      style={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: holder.color,
        color: "#ffffff",
        display: "grid",
        placeItems: "center",
        fontSize: 9,
        fontWeight: 700,
        flexShrink: 0,
        boxShadow: "0 0 0 2px var(--neutral0, #ffffff)",
        userSelect: "none",
      }}
    >
      {initialsOf(holder.name)}
    </span>
  </Tooltip>
);

const LockableInput = (props: FieldProps) => {
  const holder = useLockOwner(props.name);

  /*
   * Focus is caught on a wrapper rather than through `onFocus`/`onBlur` props: not every
   * input forwards them, and `onFocusCapture` sees focus land on whatever is inside —
   * including the inner button of a select or a date picker.
   *
   * `display: contents` makes the wrapper vanish from layout entirely, so it cannot disturb
   * the grid the Content Manager places each field in. A plain block wrapper would be
   * *nearly* neutral; this is actually neutral. DOM containment is unaffected by it, which
   * is what the check below relies on.
   */
  const onFocusCapture = () => sessionActions.claim(props.name);

  /**
   * Release only when focus has genuinely left this field.
   *
   * **This is the bug that made locking never stick.** Releasing on every blur looked right
   * and was wrong: a Strapi input moves focus between its own inner elements — a wrapper and
   * then the real input, a select's trigger and then its listbox — and each of those hops
   * fires a blur for the element being left. The lock was therefore claimed and released
   * within milliseconds, so no peer ever saw it held, and the field stayed editable for
   * everyone with nothing in any log to show why.
   *
   * `relatedTarget` is the element *receiving* focus. Still inside this wrapper means the
   * focus never left the field.
   */
  const onBlurCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    if (shouldReleaseOnBlur(event.relatedTarget as Node | null, event.currentTarget)) {
      sessionActions.release(props.name);
    }
  };

  // Released on unmount too: navigating away mid-focus fires no blur.
  React.useEffect(() => () => sessionActions.release(props.name), [props.name]);

  const input = (
    <div style={{ display: "contents" }} onFocusCapture={onFocusCapture} onBlurCapture={onBlurCapture}>
      <InputRenderer {...props} disabled={props.disabled || Boolean(holder)} />
    </div>
  );

  if (!holder) return input;

  return (
    <Flex direction="column" alignItems="stretch" gap={1}>
      {input}
      <Flex gap={2} alignItems="center">
        <HolderBadge holder={holder} />
        <Typography variant="pi" textColor="neutral600">
          {`${holder.name} is editing this field`}
        </Typography>
      </Flex>
    </Flex>
  );
};

export { LockableInput };
