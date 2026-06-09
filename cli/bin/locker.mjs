#!/usr/bin/env node

import { Command } from 'commander';
import { resolveToken, readConfig, saveToken, deleteToken, promptForToken } from '../lib/auth.mjs';
import { syncWorkspace } from '../lib/sync.mjs';
import { statusCommand } from '../lib/status.mjs';

const isTTY = process.stdout.isTTY;
const c = {
  reset:   isTTY ? '\x1b[0m'  : '',
  bold:    isTTY ? '\x1b[1m'  : '',
  dim:     isTTY ? '\x1b[2m'  : '',
  green:   isTTY ? '\x1b[32m' : '',
  yellow:  isTTY ? '\x1b[33m' : '',
  cyan:    isTTY ? '\x1b[36m' : '',
  red:     isTTY ? '\x1b[31m' : '',
  magenta: isTTY ? '\x1b[35m' : '',
};

const VALID_FORMATS = ['cursor', 'claude', 'copilot', 'gemini', 'agents', 'antigravity'];
const DEFAULT_HOST  = 'https://locker.rcormier.dev';

function fatal(msg) {
  process.stderr.write(`${c.red}✗ Error:${c.reset} ${msg}\n`);
  process.exit(1);
}

const program = new Command();

program
  .name('locker')
  .description('Sync authoritative stack rules from your Locker vault to disk')
  .version('0.1.0');

// ── auth command ──────────────────────────────────────────────────────────────

const auth = program.command('auth').description('Manage Locker API authentication');

auth
  .command('login')
  .description('Save an API token to ~/.locker/config.json')
  .option('--token <token>', 'Token to save (skips interactive prompt)')
  .action(async (opts) => {
    let token = opts.token?.trim() || null;

    if (!token) {
      token = await promptForToken();
    }

    if (!token) {
      fatal('No token provided. Run with --token <value> or in an interactive terminal.');
    }

    saveToken(token);
    process.stdout.write(
      `${c.green}${c.bold}✓ Token saved${c.reset} to ${c.dim}~/.locker/config.json${c.reset}\n`
    );
  });

auth
  .command('logout')
  .description('Remove the saved token from ~/.locker/config.json')
  .action(() => {
    const removed = deleteToken();
    if (removed) {
      process.stdout.write(`${c.green}✓ Token removed.${c.reset}\n`);
    } else {
      process.stdout.write(`${c.yellow}No saved token found.${c.reset}\n`);
    }
  });

auth
  .command('status')
  .description('Show which token source is active')
  .action(async () => {
    if (process.env.LOCKER_API_TOKEN?.trim()) {
      process.stdout.write(
        `${c.green}✓ Active${c.reset} — token from ${c.cyan}LOCKER_API_TOKEN${c.reset} env var\n`
      );
      return;
    }

    const config = readConfig();
    if (config?.token?.trim()) {
      const masked = maskToken(config.token.trim());
      process.stdout.write(
        `${c.green}✓ Active${c.reset} — token from ${c.dim}~/.locker/config.json${c.reset} (${masked})\n`
      );
      return;
    }

    process.stdout.write(
      `${c.yellow}✗ No token found.${c.reset} Run ${c.cyan}locker auth login${c.reset} to authenticate.\n`
    );
  });

// ── status command ───────────────────────────────────────────────────────────

program
  .command('status')
  .description('Check credential authorization and display workspace status')
  .option('--host <url>',            'Locker API base URL', DEFAULT_HOST)
  .option('--token <token>',         'API token (overrides env var and config file)')
  .action(async (opts) => {
    const host   = opts.host.replace(/\/$/, '');

    const token = await resolveToken({ flagToken: opts.token });
    if (!token) {
      fatal(
        'No API token found. Run `locker auth login`, set LOCKER_API_TOKEN, or pass --token.'
      );
    }

    await statusCommand({ host, token, colors: c, onFatal: fatal });
  });

// ── sync command ──────────────────────────────────────────────────────────────

program
  .command('sync')
  .description('Pull #configs and #rules from Locker and write agent config files to disk')
  .option('-f, --format <format>',   `Output format: ${VALID_FORMATS.join(' | ')}`, 'cursor')
  .option('-p, --project <key>',     'Project workspace key (default: personal scope)', '')
  .option('--host <url>',            'Locker API base URL', DEFAULT_HOST)
  .option('--token <token>',         'API token (overrides env var and config file)')
  .option('--dry-run',               'Print what would be written without touching disk')
  .action(async (opts) => {
    const format = opts.format;
    if (!VALID_FORMATS.includes(format)) {
      fatal(`Invalid --format "${format}". Must be one of: ${VALID_FORMATS.join(', ')}`);
    }

    const host       = opts.host.replace(/\/$/, '');
    const projectKey = opts.project ?? '';
    const dryRun     = opts.dryRun ?? false;

    const token = await resolveToken({ flagToken: opts.token });
    if (!token) {
      fatal(
        'No API token found. Run `locker auth login`, set LOCKER_API_TOKEN, or pass --token.'
      );
    }

    await syncWorkspace({ host, token, format, projectKey, dryRun, colors: c, onFatal: fatal });
  });

// ── default help ──────────────────────────────────────────────────────────────

program.addHelpText('after', `
${c.bold}FORMATS${c.reset}
  cursor       → .cursorrules
  claude       → CLAUDE.md
  copilot      → .github/copilot-instructions.md
  gemini       → GEMINI.md
  agents       → AGENTS.md
  antigravity  → .agents/rules/rules.md

${c.bold}EXAMPLES${c.reset}
  ${c.dim}# Check status and saved memories${c.reset}
  locker status

  ${c.dim}# Sync .cursorrules for the "locker" project${c.reset}
  locker sync --format cursor --project locker

  ${c.dim}# Save your API token interactively${c.reset}
  locker auth login

  ${c.dim}# Preview what would be written without touching disk${c.reset}
  locker sync --format claude --dry-run

  ${c.dim}# Point at a local dev server${c.reset}
  locker sync --host http://localhost:5173 --format cursor
`);

// ── helpers ───────────────────────────────────────────────────────────────────

function maskToken(token) {
  if (token.length <= 8) return '***';
  return token.slice(0, 6) + '…' + token.slice(-4);
}

program.parse();
