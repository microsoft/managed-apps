// Prints a provider-neutral description of every collection (JSON Schema per record shape).
// The add-data-source skill uses it to create SharePoint lists, Dataverse tables, etc.
// Run with: npm run storage:describe
import { allCollections } from '../src/storage/collections';
import { describeCollections } from '../src/storage/core/describe';

console.log(JSON.stringify(describeCollections(allCollections), null, 2));
