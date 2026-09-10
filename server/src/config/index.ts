/**
 * Plugin configuration, overridable from `config/plugins.ts`.
 *
 * `contentTypes` is the opt-in list: collaboration touches a live editing surface, so it is
 * enabled deliberately per content-type rather than turned on everywhere by default.
 */
export default {
  default: {
    contentTypes: [] as string[],
    debounceSeconds: 2,
  },
  validator(config: { contentTypes?: unknown; debounceSeconds?: unknown }) {
    if (config.contentTypes !== undefined && !Array.isArray(config.contentTypes)) {
      throw new Error('collab: `contentTypes` must be an array of UIDs');
    }

    if (
      config.debounceSeconds !== undefined &&
      (typeof config.debounceSeconds !== 'number' || config.debounceSeconds < 0)
    ) {
      throw new Error('collab: `debounceSeconds` must be a non-negative number');
    }
  },
};
