/**
 * status.test.mjs — Unit tests for cli/lib/status.mjs
 *
 * Uses Node.js built-in node:test runner (Node 18+). No external dependencies.
 * fetch() is mocked by temporarily replacing globalThis.fetch.
 *
 * Run: node tests/status.test.mjs
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  getMemorySummary,
  discoverConfigFiles,
  getWorkspaceSlug,
  renderMemoryTable,
  renderConfigTable,
  statusCommand,
} from '../lib/status.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TMP = join(tmpdir(), `locker-status-test-${Date.now()}`);

function makeTmpDir() {
  mkdirSync(TMP, { recursive: true });
}

function cleanTmp() {
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
}

const noColors = {
  reset: '', bold: '', dim: '', green: '', yellow: '',
  cyan: '', red: '', magenta: '',
};

const colorsOn = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
};

// Mock fetch that returns a given response
function mockFetch(responseOrFactory) {
  let callCount = 0;
  const original = globalThis.fetch;

  globalThis.fetch = async (url, opts) => {
    callCount++;
    const res = typeof responseOrFactory === 'function'
      ? responseOrFactory(url, opts, callCount)
      : responseOrFactory;
    return {
      ok:   res.ok ?? true,
      status: res.status ?? 200,
      json: async () => res.body,
      text: async () => JSON.stringify(res.body),
    };
  };

  return {
    restore: () => { globalThis.fetch = original; },
    getCallCount: () => callCount,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getMemorySummary()', () => {
  test('parses memory summary from MCP response', async () => {
    const expectedSummary = {
      user: 3,
      feedback: 2,
      project: 1,
      reference: 4,
    };

    const mock = mockFetch({
      body: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(expectedSummary),
            }
          ]
        }
      }
    });

    try {
      const summary = await getMemorySummary({
        host: 'https://locker.example.com',
        token: 'lkr_test_token',
      });

      assert.deepEqual(summary, expectedSummary);
    } finally {
      mock.restore();
    }
  });

  test('throws error on MCP response error', async () => {
    const mock = mockFetch({
      body: {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32603,
          message: 'Internal server error',
        }
      }
    });

    try {
      await assert.rejects(
        () => getMemorySummary({
          host: 'https://locker.example.com',
          token: 'lkr_test_token',
        }),
        (err) => err.message.includes('MCP error')
      );
    } finally {
      mock.restore();
    }
  });

  test('throws error on HTTP failure', async () => {
    const mock = mockFetch({
      ok: false,
      status: 401,
      body: { error: 'Unauthorized' }
    });

    try {
      await assert.rejects(
        () => getMemorySummary({
          host: 'https://locker.example.com',
          token: 'lkr_invalid_token',
        }),
        (err) => err.message.includes('HTTP 401')
      );
    } finally {
      mock.restore();
    }
  });

  test('throws error on malformed JSON in response', async () => {
    const mock = mockFetch({
      body: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            {
              type: 'text',
              text: 'invalid json {',
            }
          ]
        }
      }
    });

    try {
      await assert.rejects(
        () => getMemorySummary({
          host: 'https://locker.example.com',
          token: 'lkr_test_token',
        }),
        (err) => err.message.includes('Failed to get memory summary')
      );
    } finally {
      mock.restore();
    }
  });
});

describe('discoverConfigFiles()', () => {
  beforeEach(() => makeTmpDir());
  afterEach(() => cleanTmp());

  test('finds existing config files with timestamps', () => {
    // Create some config files
    writeFileSync(join(TMP, 'CLAUDE.md'), '# Claude Config');
    writeFileSync(join(TMP, '.cursorrules'), 'rules here');

    const files = discoverConfigFiles({ workspaceDir: TMP });

    assert.equal(files.length, 2);
    assert.ok(files.some((f) => f.file === 'CLAUDE.md'));
    assert.ok(files.some((f) => f.file === '.cursorrules'));
    assert.ok(files[0].mtime, 'has mtime');
    assert.ok(files[0].mtimeMs, 'has mtimeMs');
  });

  test('returns empty array when no config files exist', () => {
    const files = discoverConfigFiles({ workspaceDir: TMP });
    assert.equal(files.length, 0);
  });

  test('discovers nested config files like .agents/rules/rules.md', () => {
    mkdirSync(join(TMP, '.agents', 'rules'), { recursive: true });
    writeFileSync(join(TMP, '.agents', 'rules', 'rules.md'), 'agent rules');

    const files = discoverConfigFiles({ workspaceDir: TMP });

    assert.ok(files.some((f) => f.file === '.agents/rules/rules.md'));
    assert.equal(files[0].path, join(TMP, '.agents', 'rules', 'rules.md'));
  });

  test('sorts files by mtime descending (newest first)', () => {
    // Create files and verify they're returned (order may vary based on system timing)
    const file1 = join(TMP, 'CLAUDE.md');
    const file2 = join(TMP, '.cursorrules');

    writeFileSync(file1, 'content1');
    writeFileSync(file2, 'content2');

    const files = discoverConfigFiles({ workspaceDir: TMP });

    // Verify we got both files
    assert.equal(files.length, 2);
    // Verify they're sorted by mtimeMs (either ascending or descending based on creation order)
    const mtimesDescending = files[0].mtimeMs >= files[1].mtimeMs;
    assert.ok(mtimesDescending, 'files should be sorted by mtime descending');
    // Verify structure
    assert.ok(files[0].mtime);
    assert.ok(files[1].mtime);
  });
});

describe('getWorkspaceSlug()', () => {
  test('returns last directory component as workspace slug', () => {
    const slug = getWorkspaceSlug({ workspaceDir: '/home/user/my-project' });
    assert.equal(slug, 'my-project');
  });

  test('handles deep paths', () => {
    const slug = getWorkspaceSlug({ workspaceDir: '/a/b/c/d/locker' });
    assert.equal(slug, 'locker');
  });

  test('returns unknown for root path', () => {
    const slug = getWorkspaceSlug({ workspaceDir: '/' });
    assert.equal(slug, 'unknown');
  });

  test('handles single component path', () => {
    const slug = getWorkspaceSlug({ workspaceDir: 'myproject' });
    assert.equal(slug, 'myproject');
  });
});

describe('renderMemoryTable()', () => {
  test('renders memory summary table', () => {
    const summary = {
      user: 5,
      feedback: 3,
      project: 2,
      reference: 8,
    };

    const table = renderMemoryTable({ summary, colors: noColors });

    assert.ok(table.includes('user'));
    assert.ok(table.includes('feedback'));
    assert.ok(table.includes('project'));
    assert.ok(table.includes('reference'));
    assert.ok(table.includes('5'));
    assert.ok(table.includes('3'));
    assert.ok(table.includes('2'));
    assert.ok(table.includes('8'));
    assert.ok(table.includes('18')); // total
  });

  test('handles missing categories', () => {
    const summary = {
      user: 1,
      // feedback, project, reference are missing
    };

    const table = renderMemoryTable({ summary, colors: noColors });

    assert.ok(table.includes('user'));
    assert.ok(table.includes('1'));
    // Missing categories should show 0
    assert.ok(table.includes('0'));
  });

  test('includes color codes when colors provided', () => {
    const summary = { user: 1, feedback: 0, project: 0, reference: 0 };
    const table = renderMemoryTable({ summary, colors: colorsOn });

    assert.ok(table.includes('\x1b[')); // Has ANSI codes
  });

  test('calculates correct total', () => {
    const summary = {
      user: 10,
      feedback: 20,
      project: 30,
      reference: 40,
    };

    const table = renderMemoryTable({ summary, colors: noColors });

    // Total should be 100
    assert.ok(table.includes('100'));
  });
});

describe('renderConfigTable()', () => {
  test('renders config files table', () => {
    const files = [
      {
        file: 'CLAUDE.md',
        path: '/path/to/CLAUDE.md',
        mtime: '2024-01-15T10:30:00.000Z',
        mtimeMs: 1705316400000,
      },
      {
        file: '.cursorrules',
        path: '/path/to/.cursorrules',
        mtime: '2024-01-14T09:20:00.000Z',
        mtimeMs: 1705230000000,
      },
    ];

    const table = renderConfigTable({ files, colors: noColors });

    assert.ok(table.includes('CLAUDE.md'));
    assert.ok(table.includes('.cursorrules'));
    assert.ok(table.includes('2024-01-15'));
    assert.ok(table.includes('2024-01-14'));
  });

  test('returns message when no files found', () => {
    const table = renderConfigTable({ files: [], colors: noColors });

    assert.ok(table.includes('No configuration files'));
  });

  test('formats timestamps correctly', () => {
    const files = [
      {
        file: 'CLAUDE.md',
        path: '/path/to/CLAUDE.md',
        mtime: '2024-06-08T18:45:30.123Z',
        mtimeMs: 1717948530123,
      },
    ];

    const table = renderConfigTable({ files, colors: noColors });

    assert.ok(table.includes('2024-06-08T18:45:30.123Z'));
  });

  test('includes color codes when colors provided', () => {
    const files = [
      {
        file: 'CLAUDE.md',
        path: '/path/to/CLAUDE.md',
        mtime: '2024-01-15T10:30:00.000Z',
        mtimeMs: 1705316400000,
      },
    ];

    const table = renderConfigTable({ files, colors: colorsOn });

    assert.ok(table.includes('\x1b[')); // Has ANSI codes
  });
});

describe('statusCommand()', () => {
  test('executes full status workflow', async () => {
    const outputs = [];
    const stdoutWrite = process.stdout.write;
    process.stdout.write = (text) => { outputs.push(text); };

    const mock = mockFetch({
      body: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                user: 2,
                feedback: 1,
                project: 1,
                reference: 3,
              }),
            }
          ]
        }
      }
    });

    const origCwd = process.cwd;
    process.cwd = () => TMP;
    makeTmpDir();
    writeFileSync(join(TMP, 'CLAUDE.md'), 'test');

    try {
      await statusCommand({
        host: 'https://locker.example.com',
        token: 'lkr_test_token',
        colors: noColors,
        onFatal: (msg) => { throw new Error(msg); },
      });

      const output = outputs.join('');

      assert.ok(output.includes('Locker Status'));
      assert.ok(output.includes('Credential Authorization'));
      assert.ok(output.includes('Saved Memories'));
      assert.ok(output.includes('Configuration Files'));
      assert.ok(output.includes('Active Workspace'));
    } finally {
      process.stdout.write = stdoutWrite;
      mock.restore();
      process.cwd = origCwd;
      cleanTmp();
    }
  });

  test('calls onFatal when credential verification fails', async () => {
    const mock = mockFetch({
      ok: false,
      status: 401,
      body: { error: 'Unauthorized' }
    });

    try {
      let fatalCalled = false;
      let fatalMsg = '';

      await statusCommand({
        host: 'https://locker.example.com',
        token: 'lkr_bad_token',
        colors: noColors,
        onFatal: (msg) => {
          fatalCalled = true;
          fatalMsg = msg;
          throw new Error(msg);
        },
      });

      assert.fail('Should have called onFatal');
    } catch (err) {
      assert.ok(err.message.includes('Failed to verify credentials'));
    } finally {
      mock.restore();
    }
  });
});
