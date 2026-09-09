import type { Core } from '@strapi/strapi';

import { PLUGIN_ID } from '../../../shared/collab';

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  /** Live sessions and the plugin's effective configuration, for the admin page. */
  async status(ctx): Promise<void> {
    const service = strapi.plugin(PLUGIN_ID).service('collab');

    ctx.body = {
      data: {
        config: service.config(),
        sessions: service.sessions(),
      },
    };
  },
});

export default controller;
