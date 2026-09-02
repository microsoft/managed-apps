// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// src/shared/env.ts
//
// Side-effect-free module that exports the internal env var names produced by
// install-ms-cli and consumed by ms-app-pack / ms-app-deploy to coordinate
// across steps in a job. These are private to these actions.
//
// IMPORTANT — DO NOT ADD RUNTIME CODE HERE.
// The whole point of this module is that importing it from any action
// does not drag the install-ms-cli entry point's IIFE into that action's
// esbuild bundle. If you add a top-level statement that runs at import
// time (an IIFE, a `console.log`, a `getInput`...), every action that
// imports this module will start running that code when its own entry
// is loaded.

/** Set to 'true' after install-ms-cli successfully installs the CLI. */
export const MsInstalledEnvVarName = 'MS_MANAGED_APPS_INSTALLED';

/** Absolute path to the installed `ms` binary on the runner. */
export const MsPathEnvVarName = 'MS_MANAGED_APPS_PATH';
