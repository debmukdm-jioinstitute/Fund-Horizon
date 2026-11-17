// Same-origin pass-through to the hosted Finance Desk (Vercel). Fetched live on every request, so any change
// on the original site shows up here immediately.
// Always-logged-in: when FD_USER + FD_PASS are set as Worker secrets (never in git), this signs in to Finance Desk
// server-side and attaches that session itself. The password never reaches the browser, and every request is first
// gated on a Fund Horizon staff session that has the Finance Desk page. Without the secrets it falls back to the
// normal Finance Desk login screen.
export const dynamic = "force-dynamic";

const UPSTREAM = "https://finance-desk-live.vercel.app";
const BASE = "/finance-desk-app";
const COOKIE = "fd_session";

const API = process.env.API_INTERNAL_URL || "https://api.fundhorizon.website";
const PAGE = "/backoffice/finance-desk";

async function staffAllowed(req: Request): Promise<boolean> {
  const cookie = req.headers.get("cookie");
  if (!cookie) return false;
  try {
    const r = await fetch(`${API}/api/auth/me`, { headers: { cookie }, cache: "no-store" });
    if (!r.ok) return false;
    const c = await r.json();
    const pages: string[] = Array.isArray(c.pages) ? c.pages : [];
    return !!c.is_staff && (c.role === "admin" || pages.length === 0 || pages.includes(PAGE));
  } catch {
    return false;
  }
}

let session: { value: string; exp: number } | null = null;
async function desk(force = false): Promise<string | null> {
  const user = process.env.FD_USER, password = process.env.FD_PASS;
  if (!user || !password) return null;
  if (!force && session && session.exp > Date.now()) return session.value;
  try {
    const r = await fetch(`${UPSTREAM}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user, password }), cache: "no-store" });
    const sc = r.ok ? (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(`${COOKIE}=`)) : undefined;
    if (!sc) return null;
    session = { value: sc.split(";")[0], exp: Date.now() + 6 * 864e5 }; // Finance Desk sessions last 7 days
    return session.value;
  } catch {
    return null;
  }
}

async function proxy(req: Request, { params }: { params: { path?: string[] } }) {
  if (!(await staffAllowed(req))) return new Response("Sign in to Fund Horizon with Finance Desk access.", { status: 401, headers: { "cache-control": "no-store" } });
  const segs = params.path ?? [];
  if (segs.some((s) => s === ".." || s === ".")) return new Response("bad path", { status: 400 });
  const url = new URL(req.url);
  const target = `${UPSTREAM}/${segs.map(encodeURIComponent).join("/")}${url.search}`;

  let auth = await desk();
  const auto = auth !== null;
  const apiPath = segs.join("/");
  // In auto mode the shared session is never ended or replaced by the page's own login/logout calls.
  if (auto && (apiPath === "api/login" || apiPath === "api/logout")) return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;
  const ct = req.headers.get("content-type");
  const send = (cookie: string | undefined) => {
    const h = new Headers();
    if (ct) h.set("content-type", ct);
    if (cookie) h.set("cookie", cookie);
    return fetch(target, { method: req.method, headers: h, body, cache: "no-store", redirect: "manual" });
  };
  const browserFd = (req.headers.get("cookie") || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  let up: Response;
  try {
    up = await send(auth ?? browserFd);
    if (auto && up.status === 401 && segs[0] === "api") { // session expired upstream: sign in again once
      auth = await desk(true);
      if (auth) up = await send(auth);
    }
  } catch {
    return new Response("Finance Desk is unreachable", { status: 502 });
  }

  const out = new Headers();
  out.set("cache-control", "no-store");
  out.set("x-content-type-options", "nosniff");
  out.set("referrer-policy", "no-referrer");
  out.set("x-frame-options", "SAMEORIGIN");
  // Keep Finance Desk's own CSP; only allow it to be framed by Fund Horizon itself.
  out.set("content-security-policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
  const type = up.headers.get("content-type");
  if (type) out.set("content-type", type);
  const loc = up.headers.get("location");
  if (loc && loc.startsWith("/")) out.set("location", BASE + loc);
  // Scope its login cookie to this path so it is never sent with other Fund Horizon requests.
  if (!auto) for (const c of up.headers.getSetCookie?.() ?? []) out.append("set-cookie", c.replace(/Path=\/(;|$)/i, `Path=${BASE}$1`));

  if (type?.includes("text/html")) {
    const html = (await up.text()).replace(/(['"`])\/api\//g, `$1${BASE}/api/`);
    return new Response(html, { status: up.status, headers: out });
  }
  return new Response(up.body, { status: up.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as HEAD };
