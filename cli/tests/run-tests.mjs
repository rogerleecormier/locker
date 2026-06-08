/**
 * run-tests.mjs — Test orchestrator for locker-sync CLI
 *
 * Runs all test suites and prints a unified summary.
 *
 * Usage:
 *   node tests/run-tests.mjs
 *   npm test  (from cli/ directory)
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath }    from 'node:url';
import { spawnSync }        from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const isTTY = process.stdout.isTTY;
const c = {
  reset:   isTTY ? '\x1b[0m'  : '',
  bold:    isTTY ? '\x1b[1m'  : '',
  green:   isTTY ? '\x1b[32m' : '',
  yellow:  isTTY ? '\x1b[33m' : '',
  cyan:    isTTY ? '\x1b[36m' : '',
  red:     isTTY ? '\x1b[31m' : '',
  dim:     isTTY ? '\x1b[2m'  : '',
};

const TEST_FILES = [
  resolve(__dirname, 'auth.test.mjs'),
  resolve(__dirname, 'sync.test.mjs'),
];

console.log(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════╗${c.reset}`);
console.log(`${c.bold}${c.cyan}║     locker-sync CLI — Test Suite         ║${c.reset}`);
console.log(`${c.bold}${c.cyan}╚══════════════════════════════════════════╝${c.reset}\n`);
console.log(`${c.dim}Running ${TEST_FILES.length} test file(s) via node --test${c.reset}`);
console.log(`${'─'.repeat(52)}\n`);

// Run node --test with spec reporter (human-readable output)
const result = spawnSync(
  process.execPath,
  ['--test', '--test-reporter=spec', ...TEST_FILES],
  { stdio: 'inherit', env: process.env }
);

// node --test exits 0 on success, 1 on failure, 13 for unhandled (spec reporter quirk)
const exitCode = result.status ?? 1;
const allPassed = exitCode === 0;

console.log(`\n${'─'.repeat(52)}`);
if (allPassed) {
  console.log(`\n${c.green}${c.bold}✓ All tests passed!${c.reset}\n`);
} else {
  console.log(`\n${c.red}${c.bold}✗ Some tests failed. See output above.${c.reset}\n`);
}

process.exit(allPassed ? 0 : 1);
