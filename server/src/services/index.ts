import type { Core } from '@strapi/strapi';

import collab from './collab';

/** Annotated for declaration portability under pnpm (see docs/package-conventions.md). */
const services: Record<string, (context: { strapi: Core.Strapi }) => unknown> = {
  collab,
};

export default services;
