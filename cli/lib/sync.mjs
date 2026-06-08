/**
 * sync.mjs — Core sync logic for locker-sync CLI
 *
 * Calls the Locker /api/mcp JSON-RPC endpoint with the
 * sync_workspace_agent_configs tool and writes the returned rules file to disk.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname }                         from 'node:path';

const FORMAT_LABELS = {
  cursor:      '.cursorrules',
  claude:      'CLAUDE.md',
  copilot:     '.github/copilot-instructions.md',
  gemini:      'GEMINI.md',
  agents:      'AGENTS.md',
  antigravity: '.agents/rules/rules.md',
};

/**
 * Send a JSON-RPC 2.0 POST to the Locker MCP endpoint.
 *
 * @param {{ host: string, token: string, method: string, params: object }} opts
 * @returns {Promise<object>} Parsed JSON-RPC response
 */
async function mcpRequest({ host, token, method, params }) {
  const url  = `${host}/api/mcp`;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id:      Date.now(),
    method,
    params,
  });

  const response = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      'User-Agent':    'locker-sync-cli/0.1.0',
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '(unreadable body)');
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 200)}`);
  }

  return response.json();
}

/**
 * Main sync function — called by the CLI entry point.
 *
 * @param {{
 *   host:       string,
 *   token:      string,
 *   format:     string,
 *   projectKey: string,
 *   dryRun:     boolean,
 *   colors:     Record<string, string>,
 *   onFatal:    (msg: string) => never,
 * }} opts
 */
export async function syncWorkspace({ host, token, format, projectKey, dryRun, colors: c, onFatal }) {
  const label = FORMAT_LABELS[format] ?? format;

  process.stdout.write(
    `${c.bold}${c.cyan}⟳ Syncing${c.reset} ${c.bold}${label}${c.reset}` +
    ` from ${c.dim}${host}${c.reset}` +
    (projectKey ? ` [project: ${c.yellow}${projectKey}${c.reset}]` : ' [personal scope]') +
    (dryRun ? ` ${c.magenta}(dry-run)${c.reset}` : '') +
    '\n'
  );

  // Step 1 — initialize session (optional but good practice)
  try {
    await mcpRequest({
      host, token,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'locker-sync-cli', version: '0.1.0' },
        capabilities: {},
      },
    });
  } catch {
    // Non-fatal — some servers skip the initialize handshake
  }

  // Step 2 — call sync_workspace_agent_configs
  let rpcResponse;
  try {
    rpcResponse = await mcpRequest({
      host, token,
      method: 'tools/call',
      params: {
        name: 'sync_workspace_agent_configs',
        arguments: {
          formatType: format,
          projectKey: projectKey || '',
        },
      },
    });
  } catch (err) {
    onFatal(`Failed to reach Locker API: ${err.message}`);
  }

  // Step 3 — parse MCP response
  if (rpcResponse.error) {
    const { code, message } = rpcResponse.error;
    onFatal(`MCP error [${code}]: ${message}`);
  }

  let payload;
  try {
    const contentText = rpcResponse.result?.content?.[0]?.text;
    if (!contentText) throw new Error('Empty content in MCP response');
    payload = JSON.parse(contentText);
  } catch (err) {
    onFatal(`Could not parse sync response: ${err.message}`);
  }

  const { markdown, targetPath, rulesCount } = payload;

  if (!markdown || !targetPath) {
    onFatal('Sync response is missing markdown or targetPath fields');
  }

  // Step 4 — resolve absolute write path (relative to CWD)
  const absPath = join(process.cwd(), targetPath);
  const absDir  = dirname(absPath);

  process.stdout.write(
    `${c.dim}  → target: ${absPath}${c.reset}\n` +
    `${c.dim}  → rules:  ${rulesCount ?? '?'} rule(s)${c.reset}\n`
  );

  if (dryRun) {
    process.stdout.write(`\n${c.magenta}${c.bold}[dry-run] File content that would be written:${c.reset}\n`);
    process.stdout.write(`${'─'.repeat(60)}\n`);
    process.stdout.write(markdown);
    process.stdout.write(`\n${'─'.repeat(60)}\n`);
    process.stdout.write(`${c.magenta}[dry-run] No files written.${c.reset}\n`);
    return { absPath, markdown, rulesCount, dryRun: true };
  }

  // Step 5 — create directories if needed and write file
  try {
    if (!existsSync(absDir)) {
      mkdirSync(absDir, { recursive: true });
      process.stdout.write(`${c.dim}  → created directory: ${absDir}${c.reset}\n`);
    }
    writeFileSync(absPath, markdown, 'utf8');
  } catch (err) {
    onFatal(`Could not write file to ${absPath}: ${err.message}`);
  }

  process.stdout.write(
    `\n${c.green}${c.bold}✓ Done!${c.reset} ${c.bold}${label}${c.reset} written to ${c.cyan}${absPath}${c.reset}\n`
  );

  return { absPath, markdown, rulesCount, dryRun: false };
}
