/**
 * status.mjs — Status command for locker CLI
 *
 * Retrieves memory summary from Locker MCP endpoint,
 * discovers local config files with timestamps,
 * and displays workspace status information.
 */

import { statSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';

const CONFIG_FILES = [
  'CLAUDE.md',
  '.cursorrules',
  'GEMINI.md',
  'AGENTS.md',
  '.agents/rules/rules.md',
  '.github/copilot-instructions.md',
];

const MEMORY_CATEGORIES = [
  'user',
  'feedback',
  'project',
  'reference',
];

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
 * Get memory summary from Locker API.
 *
 * @param {{ host: string, token: string }} opts
 * @returns {Promise<object>} Memory summary with category counts
 */
export async function getMemorySummary({ host, token }) {
  try {
    const rpcResponse = await mcpRequest({
      host, token,
      method: 'tools/call',
      params: {
        name: 'get_memory_summary',
        arguments: {},
      },
    });

    if (rpcResponse.error) {
      const { code, message } = rpcResponse.error;
      throw new Error(`MCP error [${code}]: ${message}`);
    }

    const contentText = rpcResponse.result?.content?.[0]?.text;
    if (!contentText) throw new Error('Empty content in MCP response');

    const summary = JSON.parse(contentText);
    return summary;
  } catch (err) {
    throw new Error(`Failed to get memory summary: ${err.message}`);
  }
}

/**
 * Discover local workspace configuration files.
 *
 * @param {{ workspaceDir?: string }} opts
 * @returns {Array<{ file: string, path: string, mtime: string, mtimeMs: number }>}
 */
export function discoverConfigFiles({ workspaceDir = cwd() } = {}) {
  const found = [];

  for (const file of CONFIG_FILES) {
    const filePath = join(workspaceDir, file);

    if (existsSync(filePath)) {
      try {
        const stat = statSync(filePath);
        const mtime = new Date(stat.mtime).toISOString();
        found.push({
          file,
          path: filePath,
          mtime,
          mtimeMs: stat.mtime.getTime(),
        });
      } catch {
        // Skip files that can't be stat'd
      }
    }
  }

  // Sort by mtime descending (newest first)
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return found;
}

/**
 * Get active workspace identifier slug.
 *
 * @param {{ workspaceDir?: string }} opts
 * @returns {string} Workspace slug (directory basename or 'unknown')
 */
export function getWorkspaceSlug({ workspaceDir = cwd() } = {}) {
  const parts = workspaceDir.split('/').filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

/**
 * Render a formatted table for memory summary.
 *
 * @param {{ summary: object, colors: Record<string, string> }} opts
 * @returns {string} Formatted table
 */
export function renderMemoryTable({ summary, colors: c }) {
  const data = MEMORY_CATEGORIES.map((cat) => {
    const count = summary[cat] ?? 0;
    return { category: cat, count };
  });

  const totalCount = data.reduce((sum, row) => sum + row.count, 0);

  // Calculate column widths
  const categoryWidth = Math.max(
    'Category'.length,
    ...data.map((r) => r.category.length)
  );
  const countWidth = Math.max(
    'Count'.length,
    ...data.map((r) => r.count.toString().length),
    totalCount.toString().length
  );

  let output = '';

  // Header
  output += `${c.bold}Category${' '.repeat(categoryWidth - 'Category'.length)}  `;
  output += `Count${c.reset}\n`;

  // Divider
  output += '─'.repeat(categoryWidth) + '  ' + '─'.repeat(countWidth) + '\n';

  // Data rows
  for (const row of data) {
    const catPad = ' '.repeat(categoryWidth - row.category.length);
    const countPad = ' '.repeat(countWidth - row.count.toString().length);
    output += `${row.category}${catPad}  ${countPad}${row.count}\n`;
  }

  // Total row
  output += '─'.repeat(categoryWidth) + '  ' + '─'.repeat(countWidth) + '\n';
  const totalPad = ' '.repeat(countWidth - totalCount.toString().length);
  output += `${c.bold}Total${' '.repeat(categoryWidth - 'Total'.length)}  ${totalPad}${totalCount}${c.reset}\n`;

  return output;
}

/**
 * Render a formatted table for config files.
 *
 * @param {{ files: Array, colors: Record<string, string> }} opts
 * @returns {string} Formatted table
 */
export function renderConfigTable({ files, colors: c }) {
  if (files.length === 0) {
    return `${c.dim}No configuration files found.${c.reset}\n`;
  }

  // Calculate column widths
  const fileWidth = Math.max(
    'File'.length,
    ...files.map((f) => f.file.length)
  );
  const mtimeWidth = Math.max(
    'Last Modified'.length,
    ...files.map((f) => f.mtime.length)
  );

  let output = '';

  // Header
  output += `${c.bold}File${' '.repeat(fileWidth - 'File'.length)}  `;
  output += `Last Modified${c.reset}\n`;

  // Divider
  output += '─'.repeat(fileWidth) + '  ' + '─'.repeat(mtimeWidth) + '\n';

  // Data rows
  for (const file of files) {
    const filePad = ' '.repeat(fileWidth - file.file.length);
    output += `${c.cyan}${file.file}${c.reset}${filePad}  ${c.dim}${file.mtime}${c.reset}\n`;
  }

  return output;
}

/**
 * Main status function.
 *
 * @param {{
 *   host:       string,
 *   token:      string,
 *   colors:     Record<string, string>,
 *   onFatal:    (msg: string) => never,
 * }} opts
 */
export async function statusCommand({ host, token, colors: c, onFatal }) {
  process.stdout.write(`${c.bold}${c.cyan}⟳ Locker Status${c.reset}\n\n`);

  // Step 1 — Verify credential authorization
  process.stdout.write(`${c.bold}Credential Authorization${c.reset}\n`);
  let summary;
  try {
    summary = await getMemorySummary({ host, token });
    process.stdout.write(`${c.green}✓${c.reset} API credentials verified\n\n`);
  } catch (err) {
    onFatal(`Failed to verify credentials: ${err.message}`);
  }

  // Step 2 — Display memory summary
  process.stdout.write(`${c.bold}Saved Memories${c.reset}\n`);
  const memoryTable = renderMemoryTable({ summary, colors: c });
  process.stdout.write(memoryTable);
  process.stdout.write('\n');

  // Step 3 — Discover and display config files
  process.stdout.write(`${c.bold}Workspace Configuration Files${c.reset}\n`);
  const configFiles = discoverConfigFiles();
  const configTable = renderConfigTable({ files: configFiles, colors: c });
  process.stdout.write(configTable);
  process.stdout.write('\n');

  // Step 4 — Display workspace slug
  const slug = getWorkspaceSlug();
  process.stdout.write(`${c.bold}Active Workspace${c.reset}\n`);
  process.stdout.write(`${c.cyan}${slug}${c.reset}\n`);
}
