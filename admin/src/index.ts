import { getTranslation } from "./utils/getTranslation";
import { PLUGIN_ID } from "./pluginId";
import { LOCKABLE_TYPES } from "../../shared/collab";
import { Initializer } from "./components/Initializer";
import { LockableInput } from "./components/LockableInput";
import { PluginIcon } from "./components/PluginIcon";
import { EntryPresence } from "./components/EntryPresence";

import type { ComponentType } from "react";
import type { StrapiApp } from "@strapi/strapi/admin";

const plugin: StrapiApp["appPlugins"][string] = {
  register(app) {
    /**
     * Collaboration as a field, not a mode.
     *
     * Real-time editing is expensive and surprising, so it is opted into per field rather
     * than switched on for a whole content-type. Add it in the Content-Type Builder and
     * that field alone becomes shared.
     */
    app.customFields.register({
      name: "text",
      pluginId: PLUGIN_ID,
      type: "text",
      icon: PluginIcon,
      intlLabel: {
        id: `${PLUGIN_ID}.customField.text.label`,
        defaultMessage: "Collaborative text",
      },
      intlDescription: {
        id: `${PLUGIN_ID}.customField.text.description`,
        defaultMessage: "Edited by several people at once, with presence and cursors",
      },
      components: {
        // Strapi types the Input as a prop-less ComponentType while the Content Manager
        // actually passes it the field's layout props — see the puck plugin for the same note.
        Input: async () => {
          const { CollabTextField } = await import("./components/CollabTextField");
          return { default: CollabTextField as ComponentType };
        },
      },
    });

    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: PluginIcon,
      intlLabel: {
        id: `${PLUGIN_ID}.plugin.name`,
        defaultMessage: "Collab",
      },
      Component: () => import("./pages/App"),
      permissions: [],
    });

    /*
     * Field locking on every plain field, not only collaborative ones.
     *
     * `addFields` registers an input for a built-in type, and the Content Manager consults
     * that registry *before* its own switch — the same mechanism the upload plugin uses to
     * own the `media` input. So one registration per type puts a lock-aware wrapper in front
     * of every string, number, date, boolean, enumeration and JSON field in the panel.
     *
     * The wrapper delegates to Strapi's own `InputRenderer`; it renders nothing itself. The
     * list is bounded by what that renderer can draw — see `LOCKABLE_TYPES` for why a
     * relation or a dynamic zone is left alone.
     */
    for (const type of LOCKABLE_TYPES) {
      app.addFields({ type, Component: LockableInput as ComponentType });
    }

    app.registerPlugin({
      id: PLUGIN_ID,
      initializer: Initializer,
      isReady: false,
      name: PLUGIN_ID,
    });
  },

  bootstrap(app) {
    /**
     * Presence on every entry, Directus-style.
     *
     * Registered globally rather than per content-type: knowing someone else has this entry
     * open matters on an ordinary Article too, not only on ones with a collaborative field.
     * The component renders nothing when nobody else is in the entry.
     */
    app.getPlugin("content-manager").injectComponent("editView", "right-links", {
      name: `${PLUGIN_ID}-entry-presence`,
      Component: EntryPresence,
    });
  },

  registerTrads({ locales }) {
    return Promise.all(
      locales.map(async (locale) => {
        try {
          const { default: data } = (await import(
            `./translations/${locale}.json`
          )) as {
            default: Record<string, string>;
          };

          const newData: Record<string, string> = {};
          const keys = Object.keys(data);

          for (const key of keys) {
            newData[getTranslation(key)] = data[key];
          }

          return { data: newData, locale };
        } catch {
          return { data: {}, locale };
        }
      }),
    );
  },
};

export default plugin;