// Same-origin pass-through to the hosted Finance Desk (Vercel). Fetched live on every request, so any change
// on the original site shows up here immediately. Same-origin keeps its SameSite=Strict login cookie working
// inside the Fund Horizon iframe. Finance Desk keeps its own id+password login; nothing is stored here.
export const dynamic = "force-dynamic";

const UPSTREAM = "https://finance-desk-live.vercel.app";
const BASE = "/finance-desk-app";
const COOKIE = "fd_session";

async function proxy(req: Request, { params }: { params: { path?: string[] } }) {
  const segs = params.path ?? [];
  if (segs.some((s) => s === ".." || s === ".")) return new Response("bad path", { status: 400 });
  const url = new URL(req.url);
  const target = `${UPSTREAM}/${segs.map(encodeURIComponent).join("/")}${url.search}`;

  const headers = new Headers();
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  const fd = (req.headers.get("cookie") || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (fd) headers.set("cookie", fd); // forward only the Finance Desk session, never Fund Horizon cookies

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let up: Response;
  try {
    up = await fetch(target, { method: req.method, headers, body: hasBody ? await req.arrayBuffer() : undefined, cache: "no-store", redirect: "manual" });
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
  for (const c of up.headers.getSetCookie?.() ?? []) out.append("set-cookie", c.replace(/Path=\/(;|$)/i, `Path=${BASE}$1`));

  if (type?.includes("text/html")) {
    const html = (await up.text()).replace(/(['"`])\/api\//g, `$1${BASE}/api/`);
    return new Response(html, { status: up.status, headers: out });
  }
  return new Response(up.body, { status: up.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as HEAD };
