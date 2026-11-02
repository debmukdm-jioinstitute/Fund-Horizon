// Fund Horizon connector for Claude Desktop. Passes every message to the Fund Horizon server and returns its answer,
// so tools added to Fund Horizon later appear in Claude without reinstalling. No dependencies.
const URL_ = process.env.FH_URL;
const TOKEN = process.env.FH_TOKEN;
let buf = "";
let pending = 0;
let ended = false;

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const fail = (id, message) => id !== undefined && id !== null && send({ jsonrpc: "2.0", id, error: { code: -32000, message } });

async function forward(msg) {
  try {
    const r = await fetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(msg),
    });
    if (r.status === 401 || r.status === 403) return fail(msg.id, "Fund Horizon rejected this connector (expired or revoked). Download a new one from Fund Horizon > Settings > Claude connection.");
    if (r.status === 202) return;
    const text = await r.text();
    if (!r.ok) return fail(msg.id, `Fund Horizon returned ${r.status}`);
    for (const m of [].concat(JSON.parse(text))) send(m);
  } catch (e) {
    fail(msg.id, `Could not reach Fund Horizon (${e.message}). Check your internet connection.`);
  }
}

function line(l) {
  if (!l.trim()) return;
  let msg;
  try { msg = JSON.parse(l); } catch { return; }
  pending++;
  forward(msg).finally(() => { pending--; if (ended && !pending) process.exit(0); });
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); } });
process.stdin.on("end", () => { ended = true; if (!pending) process.exit(0); });
