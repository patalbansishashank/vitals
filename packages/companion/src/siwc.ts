/**
 * Sign in with ChatGPT, plan-usage flow (research-chatgpt-signin-and-mcp §1.2): OAuth 2 authorization code + PKCE S256
 * + state + nonce, public client (no secret), redirect to an ephemeral loopback listener on `127.0.0.1` (never
 * `localhost`), tokens kept by the Companion only (`<configDir>/siwc.json`, 0600). The page never sees a token.
 *
 * Unverified details (from the research notes, not tested against a live account): the dynamic first registration
 * (`client_id=dynamic_agent_client`, `agent_name_hint`, `ext_agent_host_id`) and the issued `oaiapp_…` client id coming
 * back as a `client_id` query parameter on the callback.
 *
 * Future work: SUITE_SPEC §7.1 asks for the OS keychain; v0.2 uses a 0600 file in the user's config directory.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { configFiles, ensureConfigDir, readInstallInfo, readJsonFile, updateInstallInfo, writeJsonSecret } from './config.ts';
import type { Logger } from './security.ts';

export interface SiwcEndpoints {
  discovery: string;
  authorize: string;
  token: string;
  revoke: string;
}

export const SIWC_ENDPOINTS: SiwcEndpoints = {
  discovery: 'https://auth.openai.com/.well-known/openid-configuration',
  authorize: 'https://auth.openai.com/api/accounts/authorize',
  token: 'https://auth.openai.com/api/accounts/oauth/token',
  revoke: 'https://auth.openai.com/api/accounts/oauth/revoke',
};
export const SIWC_SCOPES = 'openid offline_access resource.invoke chatgpt.tokens.use.direct';
export const SIWC_RESOURCE = 'https://api.openai.com/v1';
export const SIWC_DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
export const SIWC_AGENT_NAME = 'Vitals Companion';
export const SIWC_LOGIN_TIMEOUT_MS = 5 * 60_000;
/** Refresh when the access token expires within this window. */
export const SIWC_REFRESH_MARGIN_MS = 60_000;

interface SiwcTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  clientId: string;
}

export class SiwcError extends Error {
  code: 'signed_out' | 'login_failed' | 'refresh_failed' | 'state_mismatch' | 'timeout';
  constructor(code: SiwcError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'SiwcError';
  }
}

export interface SiwcLogin {
  authorizeUrl: string;
  redirectUri: string;
  /** Resolves once tokens are stored; rejects on state mismatch, OAuth error or timeout. */
  done: Promise<void>;
}

export interface Siwc {
  status(): Promise<{ signedIn: boolean; expiresAt?: string }>;
  /** A valid access token, refreshed first if it expires within 60 s. Concurrent callers share one refresh. */
  accessToken(): Promise<string>;
  /** `callbackPort` pins the loopback listener (server sign-in through `ssh -L`); default an ephemeral port. */
  login(opts?: { callbackPort?: number }): Promise<SiwcLogin>;
  logout(): Promise<void>;
  /** Cancels a pending login (closes its loopback listener). */
  close(): void;
}

export interface SiwcOptions {
  configDir: string;
  log: Logger;
  endpoints?: Partial<SiwcEndpoints>;
  fetch?: typeof globalThis.fetch;
  /** Opens the system browser; tests inject a fake. */
  openBrowser?: (url: string) => void;
  now?: () => number;
  loginTimeoutMs?: number;
}

const b64url = (buf: Buffer) => buf.toString('base64url');
export const pkceChallenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

export function openSystemBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // The URL is printed as well.
  }
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>` +
  `<body style="font:16px system-ui;margin:3rem auto;max-width:28rem;text-align:center"><h1 style="font-size:1.25rem">${title}</h1><p>${text}</p></body>`;

export function createSiwc(opts: SiwcOptions): Siwc {
  const { configDir, log, now = Date.now, loginTimeoutMs = SIWC_LOGIN_TIMEOUT_MS, openBrowser = openSystemBrowser } = opts;
  const endpoints = { ...SIWC_ENDPOINTS, ...opts.endpoints };
  const doFetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const file = configFiles(configDir).siwc;

  const load = async (): Promise<SiwcTokens | null> => {
    const t = await readJsonFile<SiwcTokens>(file);
    if (!t || typeof t.accessToken !== 'string' || typeof t.refreshToken !== 'string' || typeof t.expiresAt !== 'number') return null;
    log.addSecret(t.accessToken);
    log.addSecret(t.refreshToken);
    return t;
  };
  const store = async (t: SiwcTokens) => {
    log.addSecret(t.accessToken);
    log.addSecret(t.refreshToken);
    await ensureConfigDir(configDir);
    await writeJsonSecret(file, t);
  };

  const tokenRequest = async (params: Record<string, string>) => {
    const res = await doFetch(endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      redirect: 'error',
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, ok: res.ok, body };
  };

  const parseTokens = (body: Record<string, unknown>, clientId: string, previousRefresh?: string): SiwcTokens | null => {
    const access = body.access_token;
    const refresh = typeof body.refresh_token === 'string' ? body.refresh_token : previousRefresh;
    if (typeof access !== 'string' || !access || typeof refresh !== 'string' || !refresh) return null;
    const expiresIn = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600;
    return { accessToken: access, refreshToken: refresh, expiresAt: now() + expiresIn * 1000, clientId };
  };

  let refreshing: Promise<SiwcTokens> | null = null;
  /** Bumped by logout and by a completed login, so a refresh that was in flight then neither stores nor deletes tokens. */
  let generation = 0;
  /** Result of the last refresh: a caller that read the file before it rotated must not reuse the old refresh token. */
  let lastRefreshed: SiwcTokens | null = null;
  const refresh = (t: SiwcTokens): Promise<SiwcTokens> => {
    if (!refreshing && lastRefreshed && lastRefreshed.refreshToken !== t.refreshToken && lastRefreshed.expiresAt - now() > SIWC_REFRESH_MARGIN_MS) {
      return Promise.resolve(lastRefreshed);
    }
    refreshing ??= (async () => {
      const gen = generation;
      try {
        let r: Awaited<ReturnType<typeof tokenRequest>>;
        try {
          r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: t.clientId });
        } catch (e) {
          log(`Sign in with ChatGPT: refresh failed (${e instanceof Error ? e.name : 'error'})`);
          throw new SiwcError('refresh_failed', 'Could not refresh the ChatGPT session; try again.');
        }
        if (gen !== generation) throw new SiwcError('refresh_failed', 'The ChatGPT session changed while it was being renewed; try again.');
        const next = r.ok ? parseTokens(r.body, t.clientId, t.refreshToken) : null;
        if (!next) {
          log(`Sign in with ChatGPT: refresh failed (HTTP ${r.status})`);
          if (r.status === 400 || r.status === 401) {
            await rm(file, { force: true });
            throw new SiwcError('signed_out', 'Sign in with ChatGPT again (the session ended).');
          }
          throw new SiwcError('refresh_failed', 'Could not refresh the ChatGPT session; try again.');
        }
        await store(next);
        lastRefreshed = next;
        log('Sign in with ChatGPT: session refreshed');
        return next;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  };

  let pendingLogin: SiwcLogin | null = null;
  let cancelPending: (() => void) | null = null;

  let starting: Promise<SiwcLogin> | null = null;
  /** One sign-in at a time: concurrent callers share the pending one (and its single loopback listener). */
  const login = (o: { callbackPort?: number } = {}): Promise<SiwcLogin> => {
    if (pendingLogin) return Promise.resolve(pendingLogin);
    starting ??= startLogin(o.callbackPort ?? 0).finally(() => {
      starting = null;
    });
    return starting;
  };

  const startLogin = async (callbackPort: number): Promise<SiwcLogin> => {
    const install = await readInstallInfo(configDir);
    const verifier = b64url(randomBytes(32));
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    const clientId = install.siwcClientId ?? SIWC_DYNAMIC_CLIENT_ID;

    const server: Server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(callbackPort, '127.0.0.1', () => resolve());
    });
    const port = (server.address() as { port: number }).port;
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SIWC_SCOPES,
      resource: SIWC_RESOURCE,
      state,
      nonce,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
    });
    if (clientId === SIWC_DYNAMIC_CLIENT_ID) {
      params.set('agent_name_hint', SIWC_AGENT_NAME);
      params.set('ext_agent_host_id', `urn:uuid:${install.installId}`);
    }
    const authorizeUrl = `${endpoints.authorize}?${params.toString()}`;

    let settle!: (e?: Error) => void;
    const done = new Promise<void>((resolve, reject) => {
      settle = (e) => (e ? reject(e) : resolve());
    });
    done.catch(() => undefined);
    let finished = false;
    const finish = (e?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      pendingLogin = null;
      cancelPending = null;
      server.close();
      server.closeAllConnections();
      if (e) log(`Sign in with ChatGPT: ${e.message}`);
      settle(e);
    };
    const timer = setTimeout(() => finish(new SiwcError('timeout', 'sign-in timed out after 5 minutes')), loginTimeoutMs);
    timer.unref();

    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method !== 'GET' || url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      const html = (status: number, title: string, text: string) =>
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).end(PAGE(title, text));
      const gotState = url.searchParams.get('state') ?? '';
      if (gotState.length !== state.length || !timingSafeEqual(Buffer.from(gotState), Buffer.from(state))) {
        html(400, 'Sign-in failed', 'The sign-in response did not match this request. Start again from Vitals.');
        finish(new SiwcError('state_mismatch', 'sign-in rejected: state mismatch'));
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error || !code) {
        html(400, 'Sign-in cancelled', 'You can close this tab.');
        finish(new SiwcError('login_failed', `sign-in failed: ${error ? error.replace(/[^a-z_]/gi, '').slice(0, 40) : 'no code'}`));
        return;
      }
      // Research §1.2 (unverified): the first registration returns the issued `oaiapp_…` client id on the callback.
      const issued = url.searchParams.get('client_id');
      const useClientId = issued && /^[A-Za-z0-9_.-]{4,128}$/.test(issued) ? issued : clientId;
      void (async () => {
        try {
          const r = await tokenRequest({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: useClientId,
            code_verifier: verifier,
            resource: SIWC_RESOURCE,
          });
          const tokens = r.ok ? parseTokens(r.body, useClientId) : null;
          if (!tokens) throw new SiwcError('login_failed', `token exchange failed (HTTP ${r.status})`);
          if (typeof r.body.id_token === 'string' && !idTokenNonceMatches(r.body.id_token, nonce)) throw new SiwcError('login_failed', 'ID token nonce mismatch');
          generation += 1;
          await store(tokens);
          lastRefreshed = null;
          if (useClientId !== install.siwcClientId && useClientId !== SIWC_DYNAMIC_CLIENT_ID) await updateInstallInfo(configDir, { siwcClientId: useClientId });
          html(200, 'Signed in to Vitals', 'You can close this tab.');
          log('Sign in with ChatGPT: signed in');
          finish();
        } catch (e) {
          html(400, 'Sign-in failed', 'Start again from Vitals.');
          finish(e instanceof Error ? e : new SiwcError('login_failed', 'sign-in failed'));
        }
      })();
    });

    pendingLogin = { authorizeUrl, redirectUri, done };
    cancelPending = () => finish(new SiwcError('login_failed', 'sign-in cancelled'));
    openBrowser(authorizeUrl);
    return pendingLogin;
  };

  return {
    async status() {
      const t = await load();
      return t ? { signedIn: true, expiresAt: new Date(t.expiresAt).toISOString() } : { signedIn: false };
    },
    async accessToken() {
      if (refreshing) return (await refreshing).accessToken;
      const t = await load();
      if (!t) throw new SiwcError('signed_out', 'Sign in with ChatGPT in the Companion first.');
      if (t.expiresAt - now() > SIWC_REFRESH_MARGIN_MS) return t.accessToken;
      return (await refresh(t)).accessToken;
    },
    login,
    close: () => cancelPending?.(),
    async logout() {
      const t = await load();
      if (!t) return;
      generation += 1;
      try {
        const res = await doFetch(endpoints.revoke, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: t.refreshToken, token_type_hint: 'refresh_token', client_id: t.clientId }).toString(),
          redirect: 'error',
        });
        await res.body?.cancel();
      } catch {
        log('Sign in with ChatGPT: revoke request failed; tokens deleted locally');
      }
      await rm(file, { force: true });
      lastRefreshed = null;
      log('Sign in with ChatGPT: signed out');
    },
  };
}

/** Checks the `nonce` claim (the token comes straight from the token endpoint over TLS, so no signature check here). */
function idTokenNonceMatches(idToken: string, nonce: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { nonce?: unknown };
    return payload.nonce === undefined || payload.nonce === nonce;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Moving a sign-in to a server (SUITE_SPEC §14.3, R18 §4; OpenAI "Self-hosted VMs"): complete the sign-in where a
// browser is, then MOVE the token file. Refresh tokens rotate, so the side that refreshes second would get
// `refresh_token_reused`: the export deletes the local copy, the import deletes the export file, and from then on
// only the server refreshes. The server keeps its own install id and takes only the issued client id.

export const SIWC_EXPORT_FORMAT = 'vitals.siwc-export/1';

export interface SiwcExportFile {
  format: typeof SIWC_EXPORT_FORMAT;
  exportedAt: string;
  tokens: SiwcTokens;
}

const validTokens = (t: unknown): t is SiwcTokens => {
  const v = t as Partial<SiwcTokens> | null;
  return (
    !!v &&
    typeof v === 'object' &&
    typeof v.accessToken === 'string' &&
    v.accessToken.length > 0 &&
    typeof v.refreshToken === 'string' &&
    v.refreshToken.length > 0 &&
    typeof v.expiresAt === 'number' &&
    typeof v.clientId === 'string' &&
    /^[A-Za-z0-9_.-]{4,128}$/.test(v.clientId)
  );
};

/**
 * Writes `<outFile>` (0600, must not exist yet) from `<configDir>/siwc.json`, reads it back, then deletes the local
 * token file without revoking anything (revoking would end the session being moved). Never prints a token.
 */
export async function exportSiwc(configDir: string, outFile: string, now: () => number = Date.now): Promise<{ clientId: string; expiresAt: string }> {
  const files = configFiles(configDir);
  const tokens = await readJsonFile<SiwcTokens>(files.siwc);
  if (!validTokens(tokens)) throw new SiwcError('signed_out', 'There is no ChatGPT sign-in here to move.');
  const install = await readJsonFile<InstallInfoLike>(files.install);
  // the issued client id lives in both files; prefer the token file's (it is what refreshes use)
  const clientId = tokens.clientId || install?.siwcClientId || '';
  const body: SiwcExportFile = { format: SIWC_EXPORT_FORMAT, exportedAt: new Date(now()).toISOString(), tokens: { ...tokens, clientId } };
  await writeExclusiveSecret(outFile, `${JSON.stringify(body, null, 2)}\n`);
  const back = await readJsonFile<SiwcExportFile>(outFile);
  if (!back || !validTokens(back.tokens) || back.tokens.refreshToken !== tokens.refreshToken) {
    await rm(outFile, { force: true });
    throw new SiwcError('login_failed', 'The export file could not be read back; nothing was moved.');
  }
  await rm(files.siwc, { force: true });
  return { clientId, expiresAt: new Date(tokens.expiresAt).toISOString() };
}

/**
 * Imports an export file into `<configDir>` (a person's credentials directory on the server): writes `siwc.json`
 * (0600), copies the client id into `install.json` without touching its `installId`, then deletes the export file.
 * Refuses to replace an existing sign-in unless `force`.
 */
export async function importSiwc(configDir: string, file: string, opts: { force?: boolean } = {}): Promise<{ clientId: string; expiresAt: string }> {
  const parsed = await readJsonFile<SiwcExportFile>(file);
  if (!parsed || parsed.format !== SIWC_EXPORT_FORMAT || !validTokens(parsed.tokens)) {
    throw new SiwcError('login_failed', 'That file is not a ChatGPT sign-in export from Vitals.');
  }
  const files = configFiles(configDir);
  await ensureConfigDir(configDir);
  if (!opts.force && validTokens(await readJsonFile(files.siwc))) {
    throw new SiwcError('login_failed', 'ChatGPT is already signed in here. Sign out first or pass --force.');
  }
  await writeJsonSecret(files.siwc, parsed.tokens);
  await updateInstallInfo(configDir, { siwcClientId: parsed.tokens.clientId });
  await rm(file, { force: true });
  return { clientId: parsed.tokens.clientId, expiresAt: new Date(parsed.tokens.expiresAt).toISOString() };
}

type InstallInfoLike = { installId?: string; siwcClientId?: string };

async function writeExclusiveSecret(path: string, data: string): Promise<void> {
  const { open } = await import('node:fs/promises');
  const fh = await open(path, 'wx', 0o600);
  try {
    await fh.writeFile(data);
    await fh.chmod(0o600);
  } finally {
    await fh.close();
  }
}

/** The `ssh -L` line and the steps `siwc login --callback-port` prints on a headless server. */
export function sshForwardHint(port: number, sshHost: string): string {
  return `ssh -N -L ${port}:127.0.0.1:${port} ${sshHost}`;
}
