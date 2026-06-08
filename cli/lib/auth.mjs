/**
 * auth.mjs — API token resolution for locker-sync CLI
 *
 * Priority order:
 *   1. --token flag  (passed as flagToken option)
 *   2. LOCKER_API_TOKEN environment variable
 *   3. ~/.locker/config.json  { "token": "lkr_..." }
 *   4. Interactive readline prompt (saves to config file on success)
 */

import { createInterface }       from 'node:readline';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join }                  from 'node:path';
import { homedir }               from 'node:os';

const CONFIG_DIR  = join(homedir(), '.locker');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Read the saved config file, returning null on any error.
 * @returns {{ token?: string } | null}
 */
export function readConfig() {
  try {
    if (!existsSync(CONFIG_FILE)) return null;
    const raw = readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Persist the given token to ~/.locker/config.json.
 * Creates the directory if it doesn't exist.
 * @param {string} token
 */
export function saveToken(token) {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    const existing = readConfig() ?? {};
    writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ ...existing, token }, null, 2),
      { mode: 0o600 }
    );
  } catch (err) {
    // Non-fatal — warn but continue
    process.stderr.write(`[locker] Warning: could not save token to ${CONFIG_FILE}: ${err.message}\n`);
  }
}

/**
 * Remove the token field from ~/.locker/config.json.
 * Returns true if a token was removed, false if none existed.
 * @returns {boolean}
 */
export function deleteToken() {
  try {
    const config = readConfig();
    if (!config?.token) return false;
    const { token: _removed, ...rest } = config;
    writeFileSync(CONFIG_FILE, JSON.stringify(rest, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Prompt the user interactively for their API token.
 * Returns the token string they entered (trimmed), or null if stdin is not a TTY.
 * @returns {Promise<string | null>}
 */
export function promptForToken() {
  if (!process.stdin.isTTY) return Promise.resolve(null);

  return new Promise((resolve) => {
    const rl = createInterface({
      input:  process.stdin,
      output: process.stdout,
    });

    process.stdout.write(
      '\n🔑 Locker API token not found.\n' +
      '   Generate one at: Settings → API Tokens\n\n' +
      '   Paste your token (lkr_...): '
    );

    rl.question('', (answer) => {
      rl.close();
      const token = answer.trim();
      resolve(token || null);
    });
  });
}

/**
 * Resolve the API token using the priority chain.
 *
 * @param {{ flagToken?: string }} options
 * @returns {Promise<string | null>}
 */
export async function resolveToken({ flagToken } = {}) {
  // 1. Explicit --token flag
  if (flagToken && flagToken.trim()) {
    return flagToken.trim();
  }

  // 2. Environment variable
  const envToken = process.env.LOCKER_API_TOKEN;
  if (envToken && envToken.trim()) {
    return envToken.trim();
  }

  // 3. Config file
  const config = readConfig();
  if (config?.token && config.token.trim()) {
    return config.token.trim();
  }

  // 4. Interactive prompt
  const prompted = await promptForToken();
  if (prompted) {
    saveToken(prompted);
    return prompted;
  }

  return null;
}
