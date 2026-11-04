#!/usr/bin/env node
// Verifies local setup before `npm run dev` / `npm run build` (wired as predev and prebuild):
//  1. ms.config.json exists (created by `npx ms app init`) with an appId and environmentId;
//  2. the Office 365 Users connector code was generated into generated/ with the expected exports.
// `npm test` and `npm run lint` don't need any of this.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];

const configPath = join(root, 'ms.config.json');
if (!existsSync(configPath)) {
  problems.push('ms.config.json is missing: the app hasn\'t been created yet (npx ms app init).');
} else {
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    problems.push('ms.config.json is not valid JSON.');
  }
  if (config) {
    for (const key of ['appId', 'environmentId']) {
      const value = config[key];
      if (typeof value !== 'string' || value.trim() === '') problems.push(`ms.config.json has no "${key}".`);
    }
  }
}

// The adapter in src/connectors/office365Users.ts depends on exactly these operations.
const REQUIRED = {
  service: 'Office365UsersService',
  file: join(root, 'generated', 'services', 'Office365UsersService.ts'),
  operations: ['MyProfile_V2', 'UserProfile_V2', 'UserPhotoMetadata', 'UserPhoto_V2', 'SearchUserV2'],
};

if (!existsSync(join(root, 'generated'))) {
  problems.push('The generated/ folder is missing: the Office 365 Users connector has not been added yet.');
} else if (!existsSync(REQUIRED.file)) {
  problems.push(`generated/services/${REQUIRED.service}.ts is missing: add the Office 365 Users connector.`);
} else {
  const source = readFileSync(REQUIRED.file, 'utf8');
  if (!new RegExp(`export class ${REQUIRED.service}\\b`).test(source)) {
    problems.push(`generated/services/${REQUIRED.service}.ts does not export ${REQUIRED.service}.`);
  }
  const missing = REQUIRED.operations.filter((op) => !new RegExp(`\\b${op}\\s*\\(`).test(source));
  if (missing.length) {
    problems.push(`${REQUIRED.service} is missing operations used by the app: ${missing.join(', ')}. Re-add the connector to refresh the generated code.`);
  }
}

if (problems.length) {
  console.error('\nLearning Hub is not set up yet:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`
To fix it, follow the setup skill: .github/skills/setup-learninghub/SKILL.md
(or ask your coding agent to "set up this app"). In short:

  npx ms auth login
  npx ms app init --display-name "Learning Hub"             # optional: --environment-id <id>
  npx ms app set-setting --show-header false
  npx ms app add data-source --connector shared_office365users --as action
  cp .env.example .env.local                         # then adjust the values
  npm run check-setup
  npm run dev                                        # or: npx ms app dev
`);
  process.exit(1);
}

console.log('Setup looks good: ms.config.json exists and the Office 365 Users connector is generated.');
