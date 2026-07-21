// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/* eslint-disable no-undef */
"use strict";

import gulp from 'gulp';
import esbuild from 'esbuild';
import sourcemaps from 'gulp-sourcemaps';
import ts from 'gulp-typescript';

import fs from 'fs-extra';
import log from 'fancy-log';
import path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const tsConfigFile = './tsconfig.json';
const tsconfig = require(tsConfigFile);

const outdir = path.resolve(tsconfig.compilerOptions.outDir);
const distdir = path.resolve('./dist');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function clean() {
    await fs.emptyDir(outdir);
    await fs.emptyDir(distdir);
}

function compile() {
    const tsProj = ts.createProject(tsConfigFile);
    return gulp
        .src('src/**/*.ts')
        .pipe(sourcemaps.init())
        .pipe(tsProj())
        .pipe(sourcemaps.write('./', { sourceRoot: './', includeContent: false }))
        .pipe(gulp.dest(outdir));
}

async function dist() {
    fs.emptyDirSync(distdir);

    const actionYamls = glob.sync('**/action.yml', { cwd: __dirname, ignore: ['node_modules/**', 'dist/**', 'out/**'] })
        .filter(actionYaml => path.dirname(actionYaml) !== '.')
        .map(actionYaml => path.basename(path.dirname(actionYaml)));

    actionYamls.forEach((actionName, idx) => {
        const actionPath = path.join('actions', actionName);
        const actionDistDir = path.resolve(distdir, actionPath);
        log.info(`package action ${idx} "${actionName}" into ./dist folder (${actionDistDir})...`);
        esbuild.buildSync({
            bundle: true,
            entryPoints: [path.resolve(outdir, actionPath, 'index.js')],
            outfile: path.join(actionDistDir, 'index.js'),
            platform: 'node',
            target: 'node24',
        });
    });
}

const build = gulp.series(clean, compile, dist);

export { clean, compile, dist, build };
export default build;
