/**
 * Auth for the Trellis web app.
 *
 * Production path: Auth0 Authorization Code + PKCE, implemented dependency-
 * free (repo convention: zero runtime dependencies). Configure via
 *   VITE_AUTH0_DOMAIN    e.g. your-tenant.us.auth0.com
 *   VITE_AUTH0_CLIENT_ID SPA application client id
 *   VITE_AUTH0_AUDIENCE  (optional) API audience for an access token
 * The Auth0 application must list <origin>/callback as an allowed callback
 * URL and <origin> as an allowed logout URL.
 *
 * Local development bypass: when VITE_AUTH_BYPASS=true, or when a dev build
 * has no Auth0 config at all, the landing page offers "Continue as local
 * developer" which signs in a fake local user without touching Auth0.
 *
 * UNVERIFIED: the Auth0 redirect path has not been exercised against a real
 * tenant in this environment; the bypass path is the verified one.
 */

export interface AuthUser {
  sub: string;
  name: string;
  email?: string;
  /** true when the local dev bypass minted this user */
  bypass?: boolean;
}

const USER_KEY = "trellis.auth.user";
const PKCE_KEY = "trellis.auth.pkce";

const env = import.meta.env;
const AUTH0_DOMAIN: string | undefined = env.VITE_AUTH0_DOMAIN;
const AUTH0_CLIENT_ID: string | undefined = env.VITE_AUTH0_CLIENT_ID;
const AUTH0_AUDIENCE: string | undefined = env.VITE_AUTH0_AUDIENCE;

export const auth0Configured = Boolean(AUTH0_DOMAIN && AUTH0_CLIENT_ID);

/** The bypass is opt-in, plus automatic in dev builds with no Auth0 config. */
export const bypassAvailable = env.VITE_AUTH_BYPASS === "true" || (env.DEV && !auth0Configured);

export function getUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getUser() !== null;
}

/** Local dev bypass: mint a fake user and land on /home. */
export function loginBypass(name = "Developer"): void {
  const user: AuthUser = { sub: "dev|local", name, email: "dev@localhost", bypass: true };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.location.assign("/home");
}

/** Start the Auth0 universal-login redirect (PKCE). */
export async function login(): Promise<void> {
  if (!auth0Configured) {
    if (bypassAvailable) return loginBypass();
    throw new Error("Auth0 is not configured (set VITE_AUTH0_DOMAIN / VITE_AUTH0_CLIENT_ID).");
  }
  const verifier = randomUrlSafe(64);
  const state = randomUrlSafe(24);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: AUTH0_CLIENT_ID!,
    redirect_uri: `${window.location.origin}/callback`,
    scope: "openid profile email",
    state,
    code_challenge: await sha256Base64Url(verifier),
    code_challenge_method: "S256",
  });
  if (AUTH0_AUDIENCE) params.set("audience", AUTH0_AUDIENCE);
  window.location.assign(`https://${AUTH0_DOMAIN}/authorize?${params}`);
}

/**
 * Finish the redirect on /callback: verify state, exchange the code, store
 * the user from the id_token claims. Returns the path to land on.
 */
export async function completeLogin(): Promise<string> {
  const query = new URLSearchParams(window.location.search);
  const code = query.get("code");
  const state = query.get("state");
  const saved = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  if (!code || !state || !saved) throw new Error("Login response is missing its code or state.");
  const pkce = JSON.parse(saved) as { verifier: string; state: string };
  if (state !== pkce.state) throw new Error("Login state mismatch — please try signing in again.");

  const res = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: AUTH0_CLIENT_ID!,
      code,
      redirect_uri: `${window.location.origin}/callback`,
      code_verifier: pkce.verifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}).`);
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("Auth0 returned no id_token.");
  const claims = decodeJwtPayload(tokens.id_token);
  const user: AuthUser = {
    sub: String(claims.sub ?? "auth0|unknown"),
    name: String(claims.name ?? claims.nickname ?? claims.email ?? "Learner"),
    email: typeof claims.email === "string" ? claims.email : undefined,
  };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return "/home";
}

export function logout(): void {
  const wasBypass = getUser()?.bypass;
  localStorage.removeItem(USER_KEY);
  if (auth0Configured && !wasBypass) {
    const params = new URLSearchParams({
      client_id: AUTH0_CLIENT_ID!,
      returnTo: window.location.origin,
    });
    window.location.assign(`https://${AUTH0_DOMAIN}/v2/logout?${params}`);
  } else {
    window.location.assign("/");
  }
}

/* ---------- PKCE helpers ---------- */

function randomUrlSafe(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64Url(buf);
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1] ?? "";
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(
    atob(b64)
      .split("")
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join(""),
  );
  return JSON.parse(json) as Record<string, unknown>;
}
