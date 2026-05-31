// Build the hosted viewer (Vercel) from the assets the CLI also uses.
//
// Output:
//   viewer/index.html   — dashboard shell, NO data inlined. At /p/{slug} it fetches the
//                         map from Supabase Storage (meta alkahest:map-base).
//   viewer/account.html — GitHub login + publish-token management + project list.
//   viewer/vercel.json  — rewrites /p/:slug → index.html, /account → account.html.
//
// Config is injected here so the static files need no build step on Vercel.
// Override any value via env (see below).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(root, "src", "assets");
const OUT_DIR = join(root, "viewer");

// --- config (env-overridable) -------------------------------------------------
const SUPABASE_URL = process.env.ALKAHEST_SUPABASE_URL || "https://ytcmzkrvtomtcrcyqqcb.supabase.co";
const SUPABASE_KEY =
  process.env.ALKAHEST_SUPABASE_KEY || "sb_publishable_n3-Ct0a0okQ6Bj3Wx8Yg9w_AYBRY54E";
const FUNCTIONS_BASE = process.env.ALKAHEST_FUNCTIONS_BASE || `${SUPABASE_URL}/functions/v1`;
const MAP_BASE = process.env.ALKAHEST_MAP_BASE || `${SUPABASE_URL}/storage/v1/object/public/maps`;
const VIEWER_BASE = process.env.ALKAHEST_VIEWER_BASE || ""; // public site URL; "" = relative links

mkdirSync(OUT_DIR, { recursive: true });

// --- viewer (dashboard shell) -------------------------------------------------
let dash = readFileSync(join(ASSETS, "dashboard.html"), "utf8");
dash = dash.replace("/*__ALKAHEST_MAP__*/", ""); // no data inlined
dash = dash.replace("</head>", `    <meta name="alkahest:map-base" content="${MAP_BASE}" />\n  </head>`);
writeFileSync(join(OUT_DIR, "index.html"), dash);

// --- account page -------------------------------------------------------------
let acct = readFileSync(join(ASSETS, "account.html"), "utf8");
acct = acct
  .replace("/*__SUPABASE_URL__*/", SUPABASE_URL)
  .replace("/*__SUPABASE_KEY__*/", SUPABASE_KEY)
  .replace("/*__FUNCTIONS_BASE__*/", FUNCTIONS_BASE)
  .replace("/*__VIEWER_BASE__*/", VIEWER_BASE);
writeFileSync(join(OUT_DIR, "account.html"), acct);

// --- vercel routing -----------------------------------------------------------
const vercel = {
  rewrites: [
    { source: "/p/:slug", destination: "/index.html" },
    { source: "/account", destination: "/account.html" },
  ],
};
writeFileSync(join(OUT_DIR, "vercel.json"), JSON.stringify(vercel, null, 2) + "\n");

console.log(`[build-viewer] wrote viewer/index.html   (map-base: ${MAP_BASE})`);
console.log(`[build-viewer] wrote viewer/account.html (functions: ${FUNCTIONS_BASE})`);
console.log(`[build-viewer] wrote viewer/vercel.json`);
if (!VIEWER_BASE) console.log("[build-viewer] note: VIEWER_BASE empty — links are relative. Set ALKAHEST_VIEWER_BASE for absolute.");
