import { z } from 'zod';
import type { CollectionDefinition } from './types';

export interface CollectionDescription {
  name: string;
  description?: string;
  /** JSON Schema (draft 2020-12) for the record body, excluding provider-owned metadata. */
  schema: unknown;
  /** Provider-owned fields every backend must store alongside the record. */
  metadata: { id: 'string'; version: 'string'; createdAt: 'date-time'; updatedAt: 'date-time' };
}

/**
 * Describes collections in a provider-neutral way. The `add-data-source` skill uses this
 * (via `npm run storage:describe`) to create SharePoint lists, Dataverse tables, etc.
 */
export function describeCollections(definitions: CollectionDefinition<unknown>[]): CollectionDescription[] {
  return definitions.map((definition) => ({
    name: definition.name,
    description: definition.description,
    schema: z.toJSONSchema(definition.schema, { unrepresentable: 'any' }),
    metadata: { id: 'string', version: 'string', createdAt: 'date-time', updatedAt: 'date-time' },
  }));
}
