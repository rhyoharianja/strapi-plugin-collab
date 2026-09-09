import type { Core } from '@strapi/strapi';

import session from './session';

/** Annotated for declaration portability under pnpm (see docs/package-conventions.md). */
const controllers: Record<string, (context: { strapi: Core.Strapi }) => unknown> = {
  session,
};

export default controllers;
