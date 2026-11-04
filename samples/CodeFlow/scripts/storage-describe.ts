/**
 * Prints every storage collection as provider-neutral JSON (JSON Schema per
 * collection). Used by the add-data-source skill to provision lists/tables.
 *
 *   npm run storage:describe
 */
import { describeCollections } from '../src/storage/core/describe';
import { allCollections, KV_NAMESPACES } from '../src/storage/collections';

const output = {
  collections: describeCollections(allCollections),
  keyValueNamespaces: KV_NAMESPACES,
};

console.log(JSON.stringify(output, null, 2));
