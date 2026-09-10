import type { Core } from '@strapi/strapi';

import { PLUGIN_ID } from '../../shared/collab';

/**
 * Register the `text` custom field.
 *
 * The server only declares that the field exists and stores `text`; the admin side supplies
 * the collaborative editor. Add it to any content-type:
 *
 *   "editorialNotes": {
 *     "type": "customField",
 *     "customField": "plugin::collab.text"
 *   }
 */
const register = ({ strapi }: { strapi: Core.Strapi }) => {
  strapi.customFields.register({
    name: 'text',
    plugin: PLUGIN_ID,
    type: 'text',
  });

  strapi.log.info(`[${PLUGIN_ID}] registered custom field plugin::${PLUGIN_ID}.text`);
};

export default register;
