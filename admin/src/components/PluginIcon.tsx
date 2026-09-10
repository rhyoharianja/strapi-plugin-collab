import { User } from "@strapi/icons";

/**
 * The plugin's glyph in the main navigation.
 *
 * Distinct per plugin on purpose: the navigation is a column of icons, and with the SDK's
 * default `PuzzlePiece` in every plugin the sidebar entries were
 * indistinguishable from one another. A person reads as presence.
 */
const PluginIcon = () => <User />;

export { PluginIcon };
