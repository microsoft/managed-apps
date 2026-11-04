#!/usr/bin/env node
// Verifies this copy of the sample has been set up before `npm run dev` / `npm run build`:
//   1. ms.config.json exists (created by `npx ms app init`) with an appId and environmentId.
//   2. The GitHub connector has been added, so generated/ exports `GitHubService`
//      with every operation src/connectors/github.ts uses.
// Prints the setup steps and exits 1 when something is missing. Usage: npm run check-setup
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKILL = '.github/skills/setup-codeflow/SKILL.md';

const SETUP_STEPS = [
  'npx ms auth login',
  'npx ms app init --display-name "CodeFlow" --icon-path ./public/codeflow-logo.png   (optional: --environment-id <id>)',
  'npx ms app set-setting --show-header false',
  'npx ms app add data-source --connector shared_github --as action',
  'cp .env.example .env.local   (optional; adjust values)',
  'npm run check-setup',
  'npm run dev   (or: npx ms app dev)',
];

/** Connector operations the adapter (src/connectors/github.ts) calls. */
const REQUIRED_OPERATIONS = [
  'GetUser',
  'GetPullRequest',
  'GetPullRequests',
  'MergePullRequest',
  'SearchIssues',
  'CompareRepositoryCommits',
  'ListCollaborators',
  'checkCollaborator',
  'CreateReference',
  'CreatePullRequest',
  'SearchGithubWithQuery',
];
// SearchGithubWithQuery carries every GraphQL query and mutation the app sends (comments,
// reviews, files, branches, cherry-pick commits).

const problems = [];

// 1. ms.config.json, created by `npx ms app init`
const configPath = join(root, 'ms.config.json');
if (!existsSync(configPath)) {
  problems.push('ms.config.json is missing. Create the app with `npx ms app init` (step 2 below).');
} else {
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    problems.push('ms.config.json is not valid JSON. Re-run `npx ms app init`.');
  }
  if (config) {
    const missing = ['appId', 'environmentId'].filter((key) => typeof config[key] !== 'string' || !config[key].trim());
    if (missing.length) {
      problems.push(`ms.config.json has no ${missing.join(' or ')}. Re-run \`npx ms app init\`.`);
    }
  }
}

// 2. GitHub connector codegen
const generatedDir = join(root, 'generated');
const indexPath = join(generatedDir, 'index.ts');
const servicesDir = join(generatedDir, 'services');
const serviceFile = existsSync(servicesDir)
  ? readdirSync(servicesDir).map((name) => join(servicesDir, name)).find((file) => /export class GitHubService\b/.test(readFileSync(file, 'utf8')))
  : undefined;

if (!existsSync(indexPath) || !serviceFile) {
  problems.push('The GitHub connector has not been added (generated/ does not export GitHubService). Run step 4 below.');
} else {
  const index = readFileSync(indexPath, 'utf8');
  if (!/GitHubService/.test(index) && !/export \* from '\.\/services\//.test(index)) {
    problems.push('generated/index.ts does not export GitHubService. Re-run the connector command (step 4) to regenerate it.');
  }
  const source = readFileSync(serviceFile, 'utf8');
  const missing = REQUIRED_OPERATIONS.filter((op) => !new RegExp(`static async ${op}\\(`).test(source));
  if (missing.length) {
    problems.push(
      `GitHubService is missing operations this app uses: ${missing.join(', ')}. ` +
        'Re-add the connector (step 4) or adapt src/connectors/github.ts.',
    );
  }
}

if (problems.length) {
  console.error('\nCodeFlow setup is incomplete:\n');
  for (const problem of problems) console.error(` - ${problem}`);
  console.error('\nSetup steps (run from this folder):\n');
  SETUP_STEPS.forEach((step, i) => console.error(`  ${i + 1}. ${step}`));
  console.error(`\nDetails: README.md ("Setup") or the setup skill in ${SKILL}.\n`);
  process.exit(1);
}

console.log('CodeFlow setup looks complete.');
