import type { Core } from '@strapi/strapi';

import { PLUGIN_ID } from '../../shared/collab';

const destroy = async ({ strapi }: { strapi: Core.Strapi }) => {
  // Closing on shutdown matters in development, where the dev server reloads repeatedly and
  // orphaned WebSocket servers would pile up on the same port.
  await strapi.plugin(PLUGIN_ID).service('collab').stop();
};

export default destroy;
