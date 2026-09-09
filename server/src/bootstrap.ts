import type { Core } from '@strapi/strapi';

import { PLUGIN_ID } from '../../shared/collab';

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  // Started in `bootstrap`, not `register`: the HTTP server it attaches to does not exist
  // until Strapi has built it.
  await strapi.plugin(PLUGIN_ID).service('collab').start();
};

export default bootstrap;
