// Node entrypoint for the shared case set in tests/suite.js.
// core.js and sync-core.js are plain browser scripts that publish globals, so they are
// evaluated in this realm instead of imported (package.json declares "type":"module").
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (relative) =>
  vm.runInThisContext(readFileSync(path.join(here, '..', relative), 'utf8'), { filename: relative });

load('public/core.js');
load('public/quotes.js');
load('public/sync-core.js');

const { buildCases, buildAuthCases } = await import('./suite.js');
const { buildSitesCases } = await import('./sites-suite.js');
const AuthCore = await import('../lib/auth-core.js');
const SitesCore = await import('../functions/auth-core.mjs');
const { application } = await import('../functions/routes.mjs');
const readText = (relative) => Promise.resolve(readFileSync(path.join(here, '..', relative), 'utf8'));

const cases = [
  ...buildCases(assert, globalThis.StudyCore, globalThis.TaskSyncCore, globalThis.StudyQuotes),
  ...buildAuthCases(assert, AuthCore),
  ...buildSitesCases(assert, { application, SitesCore, readText }),
];

for (const { name, fn } of cases) {
  test(name, fn);
}
