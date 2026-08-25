#!/usr/bin/env node
// The .mcpb bundle's entire server: a stdio <-> Streamable HTTP bridge onto the HOSTED
// connector (/api/mcp/{token}). No tool logic lives here on purpose — the bundle is an
// install UX for the remote server, so tools update server-side with no bundle re-release.
// The endpoint is stateless with plain JSON responses (enableJsonResponse), which is what
// makes a bridge this small correct: every request is a self-contained POST.
//
// Zero dependencies; runs on the Node runtime Claude Desktop bundles (fetch is built in).

const url = process.env.ALKAHEST_MCP_URL;
if (!url) {
  process.stderr.write("alkahest bridge: ALKAHEST_MCP_URL is not set\n");
  process.exit(1);
}

// stdin carries newline-delimited JSON-RPC messages.
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) relay(line);
  }
});
// Exit when stdin closes — but only after in-flight requests have answered.
let pending = 0;
let closed = false;
process.stdin.on("end", () => {
  closed = true;
  if (pending === 0) process.exit(0);
});
function settle() {
  pending -= 1;
  if (closed && pending === 0) process.exit(0);
}

async function relay(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // not JSON-RPC; nothing sane to answer
  }
  pending += 1;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: line,
    });
    if (res.status === 202) return settle(); // notification/response accepted — nothing comes back
    const text = await res.text();
    if (!text) return settle();
    // The endpoint answers plain JSON; unwrap SSE defensively in case that ever changes.
    const body = (res.headers.get("content-type") || "").includes("text/event-stream")
      ? lastSseData(text)
      : text;
    if (body) writeLine(JSON.parse(body));
    settle();
  } catch (err) {
    // Only requests (id present) expect an answer; surface transport failures as JSON-RPC errors.
    if (msg && msg.id !== undefined && msg.id !== null) {
      writeLine({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32001, message: `alkahest bridge: ${err && err.message ? err.message : err}` },
      });
    }
    settle();
  }
}

function writeLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function lastSseData(text) {
  const datas = text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  return datas.length ? datas[datas.length - 1] : null;
}
