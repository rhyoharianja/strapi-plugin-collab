import type { Core } from "@strapi/strapi";

import bootstrap from "./bootstrap";
import destroy from "./destroy";
import register from "./register";

import config from "./config";
import contentTypes from "./content-types";
import controllers from "./controllers";
import middlewares from "./middlewares";
import policies from "./policies";
import routes from "./routes";
import services from "./services";

type Lifecycle = (context: { strapi: Core.Strapi }) => void | Promise<void>;
type Factory = (context: { strapi: Core.Strapi }) => unknown;

/**
 * Declared locally and referencing only `@strapi/strapi` so the emitted declaration stays
 * portable under pnpm (see docs/package-conventions.md — TS2742).
 */
interface CollabServerPlugin {
  register: Lifecycle;
  bootstrap: Lifecycle;
  destroy: Lifecycle;
  config: { default: Record<string, unknown>; validator: (config?: unknown) => void };
  controllers: Record<string, Factory>;
  routes: Record<string, unknown>;
  services: Record<string, Factory>;
  contentTypes: Record<string, { schema: Record<string, unknown> }>;
  policies: Record<string, unknown>;
  middlewares: Record<string, unknown>;
}

const plugin: CollabServerPlugin = {
  register,
  bootstrap,
  destroy,
  config,
  controllers,
  routes,
  services,
  contentTypes,
  policies,
  middlewares,
};

export default plugin;
