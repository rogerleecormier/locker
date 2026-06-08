/**
 * sync.test.mjs — Unit tests for cli/lib/sync.mjs
 *
 * Uses Node.js built-in node:test runner (Node 18+). No external dependencies.
 * fetch() is mocked by temporarily replacing globalThis.fetch.
 *
 * Run: node tests/sync.test.mjs
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { syncWorkspace } from '../lib/sync.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TMP = join(tmpdir(), `locker-sync-test-${Date.now()}`);

function makeTmpDir() {
  mkdirSync(TMP, { recursive: true });
}

function cleanTmp() {
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
}

function noop() {}
const noColors = {
  reset: '', bold: '', dim: '', green: '', yellow: '',
  cyan: '', red: '', magenta: '',
};

// Build a successful mock MCP response
function buildMcpSuccess({ markdown, targetPath, rulesCount = 5 }) {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [
        { type: 'text', text: JSON.stringify({ markdown, targetPath, rulesCount }) }
      ]
    }
  };
}

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

describe('syncWorkspace()', () => {

  beforeEach(() => makeTmpDir());
  afterEach(() => cleanTmp());

  test('writes .cursorrules to cwd for cursor format', async () => {
    const targetPath = './.cursorrules';
    const markdown   = '{"name":"Workspace Guidelines","rules":["Use TypeScript","No raw SQL"]}';

    const mock = mockFetch((url, opts, n) => {
      if (n === 1) return { body: { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } } };
      return { body: buildMcpSuccess({ markdown, targetPath }) };
    });

    // Temporarily override CWD behavior by writing to TMP
    const origCwd = process.cwd;
    process.cwd = () => TMP;

    try {
      const result = await syncWorkspace({
        host:       'https://locker.example.com',
        token:      'lkr_test_token',
        format:     'cursor',
        projectKey: 'test-project',
        dryRun:     false,
        colors:     noColors,
        onFatal:    (msg) => { throw new Error(msg); },
      });

      assert.equal(result.dryRun, false);
      assert.ok(result.absPath.endsWith('.cursorrules'), `absPath should end with .cursorrules, got: ${result.absPath}`);
      assert.ok(existsSync(result.absPath), '.cursorrules file should exist on disk');
      const written = readFileSync(result.absPath, 'utf8');
      assert.equal(written, markdown, 'file content should match API response');
    } finally {
      process.cwd = origCwd;
      mock.restore();
    }
  });

  test('creates nested directory for copilot format (.github/)', async () => {
    const targetPath = './.github/copilot-instructions.md';
    const markdown   = '# Copilot Instructions\n\n- Use TypeScript\n';

    const mock = mockFetch((url, opts, n) => {
      if (n === 1) return { body: { jsonrpc: '2.0', id: 1, result: {} } };
      return { body: buildMcpSuccess({ markdown, targetPath }) };
    });

    const origCwd = process.cwd;
    process.cwd = () => TMP;

    try {
      const result = await syncWorkspace({
        host:       'https://locker.example.com',
        token:      'lkr_test_token',
        format:     'copilot',
        projectKey: '',
        dryRun:     false,
        colors:     noColors,
        onFatal:    (msg) => { throw new Error(msg); },
      });

      assert.ok(result.absPath.includes('.github'), 'path should include .github directory');
      assert.ok(existsSync(result.absPath), 'file should be created in nested dir');
      const written = readFileSync(result.absPath, 'utf8');
      assert.equal(written, markdown);
    } finally {
      process.cwd = origCwd;
      mock.restore();
    }
  });

  test('creates nested directory for antigravity format (.agents/rules/)', async () => {
    const targetPath = './.agents/rules/rules.md';
    const markdown   = '# Antigravity Rules\n\n- Prefer functional patterns\n';

    const mock = mockFetch((url, opts, n) => {
      if (n === 1) return { body: { jsonrpc: '2.0', id: 1, result: {} } };
      return { body: buildMcpSuccess({ markdown, targetPath }) };
    });

    const origCwd = process.cwd;
    process.cwd = () => TMP;

    try {
      const result = await syncWorkspace({
        host:       'https://locker.example.com',
        token:      'lkr_test_token',
        format:     'antigravity',
        projectKey: '',
        dryRun:     false,
        colors:     noColors,
        onFatal:    (msg) => { throw new Error(msg); },
      });

      assert.ok(result.absPath.includes('.agents'), 'path should include .agents directory');
      assert.ok(existsSync(result.absPath), 'file should be created in deeply nested dir');
    } finally {
      process.cwd = origCwd;
      mock.restore();
    }
  });

  test('dry-run: does NOT write file to disk', async () => {
    const targetPath = './.cursorrules';
    const markdown   = '# dry run content';

    const mock = mockFetch((url, opts, n) => {
      if (n === 1) return { body: { jsonrpc: '2.0', id: 1, result: {} } };
      return { body: buildMcpSuccess({ markdown, targetPath }) };
    });

    const origCwd = process.cwd;
    process.cwd = () => TMP;

    // Capture stdout to verify dry-run output
    const stdoutChunks = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { stdoutChunks.push(String(chunk)); return true; };

    try {
      const result = await syncWorkspace({
        host:       'https://locker.example.com',
        token:      'lkr_test_token',
        format:     'cursor',
        projectKey: '',
        dryRun:     true,
        colors:     noColors,
        onFatal:    (msg) => { throw new Error(msg); },
      });

      assert.equal(result.dryRun, true, 'result.dryRun should be true');
      assert.ok(!existsSync(join(TMP, '.cursorrules')), 'file should NOT exist in dry-run mode');

      const output = stdoutChunks.join('');
      assert.ok(output.includes('dry-run'), 'stdout should mention dry-run');
    } finally {
      process.cwd = origCwd;
      process.stdout.write = origWrite;
      mock.restore();
    }
  });

  test('calls onFatal when HTTP request fails', async () => {
    const mock = mockFetch(() => ({
      ok: false,
      status: 401,
      body: { error: 'Unauthorized' },
    }));

    const origCwd = process.cwd;
    process.cwd = () => TMP;

    let fatalMessage = null;
    try {
      await syncWorkspace({
        host:       'https://locker.example.com',
        token:      'lkr_bad_token',
        format:     'cursor',
        projectKey: '',
        dryRun:     false,
        colors:     noColors,
        onFatal:    (msg) => { fatalMessage = msg; throw new Error(msg); },
      });
      assert.fail('Expected onFatal to be called');
    } catch (err) {
      assert.ok(fatalMessage !== null, 'onFatal should have been called');
      assert.ok(
        fatalMessage.includes('401') || fatalMessage.includes('HTTP') || fatalMessage.includes('Failed'),
        `onFatal message should mention failure, got: ${fatalMessage}`
      );
    } finally {
      process.cwd = origCwd;
      mock.restore();
    }
  });

  test('calls onFatal when MCP returns an error object', async () => {
    const mock = mockFetch((url, opts, n) => {
      if (n === 1) return { body: { jsonrpc: '2.0', id: 1, result: {} } };
      return {
        body: {
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32003, message: 'Forbidden: no access to vault scope' }
        }
      };
    });

    const origCwd = process.cwd;
    process.cwd = () => TMP;

    let fatalMessage = null;
    try {
      await syncWorkspace({
        host:       'https://locker.example.com',
        token:      'lkr_test_token',
        format:     'cursor',
        projectKey: 'nonexistent-project',
        dryRun:     false,
        colors:     noColors,
        onFatal:    (msg) => { fatalMessage = msg; throw new Error(msg); },
      });
      assert.fail('Expected onFatal to be called');
    } catch {
      assert.ok(fatalMessage !== null);
      assert.ok(
        fatalMessage.includes('-32003') || fatalMessage.includes('Forbidden') || fatalMessage.includes('MCP error'),
        `should include error details, got: ${fatalMessage}`
      );
    } finally {
      process.cwd = origCwd;
      mock.restore();
    }
  });

  test('calls onFatal when MCP response has empty content', async () => {
    const mock = mockFetch((url, opts, n) => {
      if (n === 1) return { body: { jsonrpc: '2.0', id: 1, result: {} } };
      return { body: { jsonrpc: '2.0', id: 1, result: { content: [] } } };
    });

    const origCwd = process.cwd;
    process.cwd = () => TMP;

    let fatalMessage = null;
    try {
      await syncWorkspace({
        host: 'https://locker.example.com',
        token: 'lkr_test',
        format: 'cursor',
        projectKey: '',
        dryRun: false,
        colors: noColors,
        onFatal: (msg) => { fatalMessage = msg; throw new Error(msg); },
      });
      assert.fail('Expected onFatal');
    } catch {
      assert.ok(fatalMessage !== null, 'onFatal should fire on empty content');
    } finally {
      process.cwd = origCwd;
      mock.restore();
    }
  });

  test('network failure calls onFatal with descriptive message', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED: connection refused'); };

    const origCwd = process.cwd;
    process.cwd = () => TMP;

    let fatalMessage = null;
    try {
      await syncWorkspace({
        host:       'http://localhost:9999',
        token:      'lkr_test_token',
        format:     'cursor',
        projectKey: '',
        dryRun:     false,
        colors:     noColors,
        onFatal:    (msg) => { fatalMessage = msg; throw new Error(msg); },
      });
      assert.fail('Expected onFatal to be called on network error');
    } catch {
      assert.ok(fatalMessage !== null);
      assert.ok(
        fatalMessage.toLowerCase().includes('failed') || fatalMessage.toLowerCase().includes('econnrefused'),
        `message should describe failure, got: ${fatalMessage}`
      );
    } finally {
      process.cwd = origCwd;
      globalThis.fetch = original;
    }
  });

  test('sends correct Authorization Bearer header', async () => {
    let capturedHeaders = null;

    const mock = mockFetch((url, opts, n) => {
      capturedHeaders = opts.headers;
      if (n === 1) return { body: { jsonrpc: '2.0', id: 1, result: {} } };
      return { body: buildMcpSuccess({ markdown: '# test', targetPath: './.cursorrules' }) };
    });

    const origCwd = process.cwd;
    process.cwd = () => TMP;

    try {
      await syncWorkspace({
        host:       'https://locker.example.com',
        token:      'lkr_expected_token',
        format:     'cursor',
        projectKey: '',
        dryRun:     false,
        colors:     noColors,
        onFatal:    (msg) => { throw new Error(msg); },
      });

      assert.equal(
        capturedHeaders['Authorization'],
        'Bearer lkr_expected_token',
        'Authorization header should use Bearer scheme'
      );
    } finally {
      process.cwd = origCwd;
      mock.restore();
    }
  });

  test('sends correct formatType and projectKey in MCP request body', async () => {
    let capturedBodies = [];

    const mock = mockFetch((url, opts, n) => {
      const body = JSON.parse(opts.body);
      capturedBodies.push(body);
      if (n === 1) return { body: { jsonrpc: '2.0', id: 1, result: {} } };
      return { body: buildMcpSuccess({ markdown: '# gemini', targetPath: './GEMINI.md' }) };
    });

    const origCwd = process.cwd;
    process.cwd = () => TMP;

    try {
      await syncWorkspace({
        host:       'https://locker.example.com',
        token:      'lkr_test',
        format:     'gemini',
        projectKey: 'my-project-key',
        dryRun:     false,
        colors:     noColors,
        onFatal:    (msg) => { throw new Error(msg); },
      });

      // Find the tools/call request
      const toolCall = capturedBodies.find(b => b.method === 'tools/call');
      assert.ok(toolCall, 'should send a tools/call request');
      assert.equal(toolCall.params.name, 'sync_workspace_agent_configs');
      assert.equal(toolCall.params.arguments.formatType, 'gemini');
      assert.equal(toolCall.params.arguments.projectKey, 'my-project-key');
    } finally {
      process.cwd = origCwd;
      mock.restore();
    }
  });

  test('initializes session before tool call (initialize method)', async () => {
    const methods = [];

    const mock = mockFetch((url, opts, n) => {
      const body = JSON.parse(opts.body);
      methods.push(body.method);
      if (n === 1) return { body: { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } } };
      return { body: buildMcpSuccess({ markdown: '# claude', targetPath: './CLAUDE.md' }) };
    });

    const origCwd = process.cwd;
    process.cwd = () => TMP;

    try {
      await syncWorkspace({
        host:       'https://locker.example.com',
        token:      'lkr_test',
        format:     'claude',
        projectKey: '',
        dryRun:     false,
        colors:     noColors,
        onFatal:    (msg) => { throw new Error(msg); },
      });

      assert.ok(methods.includes('initialize'), 'should send initialize method first');
      assert.ok(methods.includes('tools/call'), 'should send tools/call');
      assert.ok(
        methods.indexOf('initialize') < methods.indexOf('tools/call'),
        'initialize should come before tools/call'
      );
    } finally {
      process.cwd = origCwd;
      mock.restore();
    }
  });

  test('rulesCount from API response is returned in result', async () => {
    const mock = mockFetch((url, opts, n) => {
      if (n === 1) return { body: { jsonrpc: '2.0', id: 1, result: {} } };
      return { body: buildMcpSuccess({ markdown: '# test', targetPath: './.cursorrules', rulesCount: 42 }) };
    });

    const origCwd = process.cwd;
    process.cwd = () => TMP;

    try {
      const result = await syncWorkspace({
        host:       'https://locker.example.com',
        token:      'lkr_test',
        format:     'cursor',
        projectKey: '',
        dryRun:     false,
        colors:     noColors,
        onFatal:    (msg) => { throw new Error(msg); },
      });

      assert.equal(result.rulesCount, 42);
    } finally {
      process.cwd = origCwd;
      mock.restore();
    }
  });

  test('JSON-RPC request includes jsonrpc 2.0 and a numeric id', async () => {
    let capturedBody = null;

    const mock = mockFetch((url, opts, n) => {
      const body = JSON.parse(opts.body);
      if (n === 2) capturedBody = body; // second call is tools/call
      if (n === 1) return { body: { jsonrpc: '2.0', id: 1, result: {} } };
      return { body: buildMcpSuccess({ markdown: '# agents', targetPath: './AGENTS.md' }) };
    });

    const origCwd = process.cwd;
    process.cwd = () => TMP;

    try {
      await syncWorkspace({
        host:       'https://locker.example.com',
        token:      'lkr_test',
        format:     'agents',
        projectKey: '',
        dryRun:     false,
        colors:     noColors,
        onFatal:    (msg) => { throw new Error(msg); },
      });

      assert.equal(capturedBody.jsonrpc, '2.0', 'should use JSON-RPC 2.0');
      assert.ok(typeof capturedBody.id === 'number', 'id should be a number');
    } finally {
      process.cwd = origCwd;
      mock.restore();
    }
  });
});
