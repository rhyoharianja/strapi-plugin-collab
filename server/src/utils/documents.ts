import type { Core } from '@strapi/strapi';

/** A row as returned by the Document Service, with relations populated on demand. */
export type DocumentRow = Record<string, any>;

/**
 * Minimal Document Service surface this plugin uses.
 *
 * The flow engine addresses arbitrary content-types by UID at runtime — a flow is data, so
 * the target is never known at compile time. That alone rules out Strapi's generated
 * per-UID types.
 *
 * Strapi generates its `UID` and `Input<...>` types from the *application's* schemas, so a
 * plugin's own content-types are absent from that registry: `strapi.documents(uid)` types
 * every payload as `{}` and rejects real data. Narrowing to this hand-written interface
 * keeps call sites readable and, unlike the inferred type, references only
 * `@strapi/strapi` — which is also what keeps the emitted declarations portable (TS2742).
 */
export interface DocumentService {
  findMany(params?: Record<string, unknown>): Promise<DocumentRow[]>;
  findFirst(params?: Record<string, unknown>): Promise<DocumentRow | null>;
  create(params: { data: Record<string, unknown> }): Promise<DocumentRow>;
  update(params: { documentId: string; data: Record<string, unknown> }): Promise<DocumentRow>;
  delete(params: { documentId: string }): Promise<unknown>;
  publish(params: { documentId: string }): Promise<unknown>;
  unpublish(params: { documentId: string }): Promise<unknown>;
}

export const documents = (strapi: Core.Strapi, uid: string): DocumentService =>
  strapi.documents(uid as Parameters<Core.Strapi['documents']>[0]) as unknown as DocumentService;
