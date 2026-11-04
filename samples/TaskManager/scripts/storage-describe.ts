// Prints every app collection as provider-neutral JSON Schema, for provisioning a
// shared backend (SharePoint lists, Dataverse tables, ...). Used by the
// add-data-source skill.  Usage: npm run storage:describe [-- --markdown]
import { allCollections } from "../src/storage/collections";
import { describeCollections } from "../src/storage/core/describe";

const descriptions = describeCollections(allCollections);

if (process.argv.includes("--markdown")) {
  for (const description of descriptions) {
    const schema = description.schema as { properties?: Record<string, { type?: unknown }>; required?: string[] };
    console.log(`## ${description.name}\n`);
    if (description.description) console.log(`${description.description}\n`);
    console.log("| Field | Type | Required |\n|---|---|---|");
    for (const [field, spec] of Object.entries(schema.properties ?? {})) {
      const type = Array.isArray(spec.type) ? spec.type.join(" | ") : String(spec.type ?? "object");
      console.log(`| ${field} | ${type} | ${schema.required?.includes(field) ? "yes" : "no"} |`);
    }
    console.log("");
  }
} else {
  console.log(JSON.stringify(descriptions, null, 2));
}
