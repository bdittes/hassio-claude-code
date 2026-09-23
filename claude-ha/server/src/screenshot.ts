/**
 * Dashboard screenshots through a headless Chromium.
 *
 * The browser logs into the Home Assistant frontend with a long-lived access
 * token the user creates in their profile (the Supervisor token cannot log
 * into the frontend, and ingress never hands the add-on the user's session).
 * The token is injected into the frontend's localStorage the same way a
 * normal login stores it, so no login form is involved.
 *
 * Chromium is heavy, so it is launched on the first request and closed again
 * after a short idle period. Requests are serialized: a Raspberry Pi does not
 * want two renders at once.
 *
 * The token only ever lives in this Node process. It is not part of any
 * environment the model's shell can see.
 */
import fs from 'node:fs';
import type { Browser } from 'playwright-core';
import type { Logger } from './config.js';

export interface ScreenshotRequest {
  /** Frontend path, for example /lovelace/kitchen or /dashboard-energy. */
  path: string;
  width?: number;
  height?: number;
  dark?: boolean;
  /** Extra settle time after the page has loaded, for slow cards. */
  waitMs?: number;
}

export interface ScreenshotResult {
  image: Buffer;
  mimeType: 'image/png' | 'image/jpeg';
  url: string;
  title: string;
  /** Text of error and warning cards (unknown card types, missing entities, ...). */
  cardErrors: string[];
  /** Errors the page logged to the browser console. */
  consoleErrors: string[];
}

export interface DashboardBrowserOptions {
  /** Base URL of the frontend as seen from inside the add-on, e.g. http://homeassistant:8123 */
  frontendUrl: () => string;
  token: string;
  log: Logger;
  executablePath?: string;
  idleMs?: number;
}

export const MIN_WIDTH = 320;
export const MAX_WIDTH = 2560;
export const MAX_HEIGHT = 4000;
/** The Messages API rejects larger images; fall back to JPEG above this. */
const MAX_PNG_BYTES = 3_500_000;

const CHROMIUM_CANDIDATES = [
  process.env.CLAUDE_HA_CHROMIUM,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/pw-browsers/chromium',
].filter((p): p is string => !!p);

export function findChromium(): string | undefined {
  return CHROMIUM_CANDIDATES.find((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Resolve a model-supplied path against the frontend origin. Only same-origin
 * frontend pages are allowed: no other hosts, no auth flow, no raw API.
 */
export function resolveFrontendPath(base: string, rawPath: string): URL {
  const p = (rawPath || '/').trim();
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\')) {
    throw new Error('path must be a frontend path starting with /, for example /lovelace/0');
  }
  const origin = new URL(base);
  const url = new URL(p, origin);
  if (url.origin !== origin.origin) throw new Error('path must stay on the Home Assistant frontend');
  if (/^\/(auth|api)(\/|$)/.test(url.pathname)) throw new Error('auth and API URLs cannot be screenshotted');
  return url;
}

// Page-side scripts. Kept as strings: they run in the browser, and the
// server's TypeScript setup has no DOM types.

/** Seed the frontend's localStorage exactly as a normal login would. */
function initScript(origin: string, tokens: Record<string, unknown>, dark: boolean): string {
  return `(() => {
    if (location.origin !== ${JSON.stringify(origin)}) return;
    try {
      localStorage.setItem('hassTokens', ${JSON.stringify(JSON.stringify(tokens))});
      localStorage.setItem('dockedSidebar', JSON.stringify('always_hidden'));
      localStorage.setItem('selectedTheme', JSON.stringify({ theme: 'default', dark: ${dark} }));
    } catch (e) {
      // storage unavailable: the page shows the login screen, which is reported
    }
  })();`;
}

/** The app shell has rendered (or we were bounced to the login page). */
const APP_READY = `(() => {
  if (location.pathname.startsWith('/auth/')) return true;
  const root = document.querySelector('home-assistant')?.shadowRoot;
  return !!root?.querySelector('home-assistant-main');
})()`;

/**
 * Error and warning cards anywhere in the DOM (including shadow roots), each
 * with the card and entity it belongs to: the visible text alone ("Configuration
 * error") says nothing about what is wrong.
 */
const COLLECT_CARD_ERRORS = `(() => {
  const found = [];
  const parentOf = (el) => el.parentElement || (el.parentNode && el.parentNode.host) || null;
  const context = (el) => {
    let entity, card;
    for (let p = parentOf(el), i = 0; p && i < 40; p = parentOf(p), i++) {
      const cfg = p._config || p.config;
      if (!entity && cfg && typeof cfg.entity === 'string') entity = cfg.entity;
      if (p.tagName && p.tagName.toLowerCase() === 'hui-card' && p.config) { card = p.config; break; }
    }
    return { entity, card };
  };
  const hassOf = () => document.querySelector('home-assistant')?.hass;
  const describe = (el, tag) => {
    const { entity, card } = context(el);
    let message = el._config && (el._config.message || el._config.error);
    if (!message && tag !== 'hui-error-card' && entity) {
      const hass = hassOf();
      if (hass && hass.states && !hass.states[entity]) message = 'Entity not found: ' + entity;
    }
    if (!message) message = ((el.shadowRoot ? el.shadowRoot.textContent : '') + ' ' + (el.textContent || '')).replace(/\\s+/g, ' ').trim();
    if (!message) return;
    const where = [];
    if (card && card.type) where.push('card: ' + card.type + (card.title ? ' "' + card.title + '"' : ''));
    if (entity && !message.includes(entity)) where.push('entity: ' + entity);
    found.push((message + (where.length ? ' [' + where.join(', ') + ']' : '')).slice(0, 400));
  };
  const visit = (root, inWarning) => {
    for (const el of root.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      const isWarning = tag === 'hui-warning' || tag === 'hui-warning-element';
      // A warning renders its own error card inside; report the warning once.
      if (isWarning || (tag === 'hui-error-card' && !inWarning)) describe(el, tag);
      if (el.shadowRoot) visit(el.shadowRoot, inWarning || isWarning);
    }
  };
  visit(document, false);
  return [...new Set(found)].slice(0, 25);
})()`;

function clamp(n: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export class DashboardBrowser {
  private browser: Promise<Browser> | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: DashboardBrowserOptions) {}

  get configured(): boolean {
    return !!this.opts.token;
  }

  get executablePath(): string | undefined {
    return this.opts.executablePath ?? findChromium();
  }

  screenshot(req: ScreenshotRequest): Promise<ScreenshotResult> {
    const run = this.queue.then(() => this.capture(req));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    const b = this.browser;
    this.browser = undefined;
    if (b) await (await b.catch(() => undefined))?.close().catch(() => undefined);
  }

  private async getBrowser(): Promise<Browser> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.browser) {
      const executablePath = this.executablePath;
      if (!executablePath) throw new Error('Chromium is not installed in this add-on image.');
      const { chromium } = await import('playwright-core');
      this.opts.log.info(`starting headless Chromium (${executablePath})`);
      this.browser = chromium
        .launch({
          executablePath,
          // Runs as root inside the add-on container.
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars'],
        })
        .then((b) => {
          b.on('disconnected', () => {
            this.browser = undefined;
          });
          return b;
        });
      this.browser.catch(() => {
        this.browser = undefined;
      });
    }
    return this.browser;
  }

  private scheduleIdleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.opts.log.debug('closing idle Chromium');
      void this.close();
    }, this.opts.idleMs ?? 90_000);
    this.idleTimer.unref();
  }

  private async capture(req: ScreenshotRequest): Promise<ScreenshotResult> {
    if (!this.configured) throw new Error('No dashboard access token configured.');
    const base = this.opts.frontendUrl();
    const url = resolveFrontendPath(base, req.path);
    const width = clamp(req.width, MIN_WIDTH, MAX_WIDTH, 1280);
    const height = clamp(req.height, 240, MAX_HEIGHT, 900);
    const waitMs = clamp(req.waitMs, 0, 15_000, 1500);
    const origin = url.origin;

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: req.dark ? 'dark' : 'light',
      // Home Assistant with its own TLS certificate is reached by an internal
      // host name the certificate does not cover.
      ignoreHTTPSErrors: true,
    });
    const consoleErrors: string[] = [];
    try {
      // Same shape the frontend stores after a normal login.
      const tokens = {
        access_token: this.opts.token,
        token_type: 'Bearer',
        expires_in: 1800,
        hassUrl: origin,
        clientId: `${origin}/`,
        expires: 9_999_999_999_999,
        refresh_token: '',
      };
      await context.addInitScript({ content: initScript(origin, tokens, !!req.dark) });

      const page = await context.newPage();
      const pendingLogs: Promise<void>[] = [];
      page.on('console', (m) => {
        if (m.type() !== 'error' || consoleErrors.length + pendingLogs.length >= 10) return;
        const text = m.text();
        // The frontend often logs bare objects, which stringify as "Object".
        if (!/^(Object|JSHandle@\w+)$/.test(text)) {
          consoleErrors.push(text.slice(0, 300));
          return;
        }
        pendingLogs.push(
          Promise.all(m.args().map((a) => a.jsonValue().catch(() => '?')))
            .then((vals) => void consoleErrors.push(JSON.stringify(vals.length === 1 ? vals[0] : vals).slice(0, 300)))
            .catch(() => undefined),
        );
      });
      page.on('pageerror', (e) => {
        const msg = String(e.message ?? '').trim();
        // A thrown plain object arrives as "Object" with nothing else to go on.
        if (!msg || /^(Object|\[object Object\])$/.test(msg) || consoleErrors.length >= 10) return;
        consoleErrors.push(msg.slice(0, 300));
      });

      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForFunction(APP_READY, undefined, { timeout: 30_000 }).catch(() => undefined);
      if (new URL(page.url()).pathname.startsWith('/auth/')) {
        throw new Error(
          'Home Assistant rejected the dashboard access token (the browser was sent to the login page). Create a new long-lived access token and update the add-on option.',
        );
      }
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      if (waitMs) await page.waitForTimeout(waitMs);

      const cardErrors = (await page.evaluate(COLLECT_CARD_ERRORS).catch(() => [])) as string[];
      await Promise.all(pendingLogs);

      let image = await page.screenshot({ type: 'png' });
      let mimeType: ScreenshotResult['mimeType'] = 'image/png';
      if (image.length > MAX_PNG_BYTES) {
        image = await page.screenshot({ type: 'jpeg', quality: 80 });
        mimeType = 'image/jpeg';
      }
      return { image, mimeType, url: page.url().replace(origin, ''), title: await page.title(), cardErrors, consoleErrors };
    } finally {
      await context.close().catch(() => undefined);
      this.scheduleIdleClose();
    }
  }
}
