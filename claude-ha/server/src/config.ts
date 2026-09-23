/**
 * Runtime configuration.
 *
 * Inside the add-on the s6 run script reads /data/options.json with bashio and
 * exports everything as environment variables, so this module only reads env.
 * Running outside Home Assistant (local development) works with sensible defaults.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { AuthMethod } from './auth.js';
export type { AuthMethod };

export interface AppConfig {
  port: number;
  /** Directory the agent operates in. /config on Home Assistant OS. */
  configDir: string;
  /** Persistent add-on data directory. /data on Home Assistant OS. */
  dataDir: string;
  /** Directory the built Vue app is served from. */
  publicDir: string;
  /**
   * How the Claude Code subprocess authenticates. `oauth` uses a subscription
   * OAuth token (default); `api_key` is the legacy static key.
   */
  authMethod: AuthMethod;
  /** Subscription OAuth token from `claude setup-token`. */
  oauthToken: string;
  /** Only used when authMethod is `api_key`. */
  anthropicApiKey: string;
  anthropicBaseUrl: string;
  model: string;
  logLevel: 'debug' | 'info' | 'warning' | 'error';
  supervisorToken: string;
  supervisorUrl: string;
  autoApproveReadOnly: boolean;
  /**
   * Long-lived access token for dashboard screenshots. Read straight from
   * /data/options.json, never from the environment, so it cannot leak into
   * the model's shell through an inherited variable.
   */
  dashboardToken: string;
  /** Frontend base URL override; derived from the Supervisor's core info when empty. */
  frontendUrl: string;
  version: string;
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** The add-on options as the Supervisor wrote them, or {} outside Home Assistant. */
function readOptions(dataDir: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'options.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(): AppConfig {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const dataDir = process.env.CLAUDE_HA_DATA_DIR ?? '/data';
  const configDir = process.env.CLAUDE_HA_CONFIG_DIR ?? '/config';
  const logLevelRaw = (process.env.CLAUDE_HA_LOG_LEVEL ?? 'info').toLowerCase();
  const logLevel = (['debug', 'info', 'warning', 'error'].includes(logLevelRaw)
    ? logLevelRaw
    : 'info') as AppConfig['logLevel'];

  const options = readOptions(dataDir);
  const optString = (key: string) => (typeof options[key] === 'string' ? (options[key] as string).trim() : '');

  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '';
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const authMethodRaw = (process.env.CLAUDE_HA_AUTH_METHOD ?? '').toLowerCase();
  // OAuth is the default. Without an explicit choice, an API key alone
  // (typical for local development) still selects the legacy path.
  const authMethod: AuthMethod =
    authMethodRaw === 'api_key' || authMethodRaw === 'oauth'
      ? authMethodRaw
      : !oauthToken && anthropicApiKey
        ? 'api_key'
        : 'oauth';

  return {
    port: Number(process.env.CLAUDE_HA_PORT ?? 8099),
    authMethod,
    oauthToken,
    configDir,
    dataDir,
    publicDir: process.env.CLAUDE_HA_PUBLIC_DIR ?? path.resolve(here, '..', 'public'),
    anthropicApiKey,
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL ?? '',
    model: process.env.CLAUDE_HA_MODEL ?? '',
    logLevel,
    supervisorToken: process.env.SUPERVISOR_TOKEN ?? '',
    supervisorUrl: process.env.SUPERVISOR_URL ?? 'http://supervisor',
    autoApproveReadOnly: envBool('CLAUDE_HA_AUTO_APPROVE_READONLY', true),
    // CLAUDE_HA_DASHBOARD_TOKEN is only for local development; the agent's
    // subprocess env drops it (see agent.ts).
    dashboardToken: optString('dashboard_token') || process.env.CLAUDE_HA_DASHBOARD_TOKEN || '',
    frontendUrl: (optString('frontend_url') || process.env.CLAUDE_HA_FRONTEND_URL || '').replace(/\/+$/, ''),
    version: readVersion(),
  };
}

const LEVELS = { debug: 10, info: 20, warning: 30, error: 40 } as const;

export function createLogger(level: AppConfig['logLevel']) {
  const min = LEVELS[level];
  const emit = (lvl: keyof typeof LEVELS, args: unknown[]) => {
    if (LEVELS[lvl] < min) return;
    const ts = new Date().toISOString();
    const line = args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack ?? a.message : JSON.stringify(a)))
      .join(' ');
    const out = lvl === 'error' || lvl === 'warning' ? process.stderr : process.stdout;
    out.write(`[${ts}] ${lvl.toUpperCase().padEnd(7)} ${line}\n`);
  };
  return {
    debug: (...a: unknown[]) => emit('debug', a),
    info: (...a: unknown[]) => emit('info', a),
    warning: (...a: unknown[]) => emit('warning', a),
    error: (...a: unknown[]) => emit('error', a),
  };
}

export type Logger = ReturnType<typeof createLogger>;
