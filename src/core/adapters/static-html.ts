import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep, posix } from "node:path";
import type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * Plain multi-page HTML sites — the lowest-fidelity fallback (registered last). Each `.html`
 * file is a page; cross-page `<a href>` links are transitions. Zero-dependency regex scan.
 *
 * Because it's last in the registry, by the time this runs the project matched no framework —
 * so "a folder of .html files" still yields a product map.
 *
 * Mapping:
 *  - screen id = the page's route ("/about", "/docs/intro"; index.html → its dir)
 *  - nav = <a href="other.html"> resolved (relative to the page) to a route id
 *  - call = <form action> / <script> fetch()/XHR
 *  - feature = <button>, <input|textarea|select>, <form>
 */
const HTML_RE = /\.html?$/i;
const SKIP_DIRS = /^(node_modules|dist|build|out|coverage|\.git)$/i;

export const staticHtmlAdapter: FrameworkAdapter = {
  id: "static",
  router: "static-html",

  detect(projectRoot) {
    let found = false;
    walkHtml(projectRoot, () => {
      found = true;
    });
    return found;
  },

  discover(projectRoot) {
    const files: ScreenFile[] = [];
    walkHtml(projectRoot, (file) => {
      const route = routeFromHtmlFile(projectRoot, file);
      files.push({
        absPath: file,
        relPath: relative(projectRoot, file).split(sep).join("/"),
        id: route,
        route,
        title: titleFromHtmlFile(route, file),
        isEntry: route === "/",
      });
    });
    files.sort((a, b) => a.route.localeCompare(b.route));
    return files;
  },

  parse(file) {
    return parseHtml(safeRead(file.absPath), file.route);
  },
};

// ---------- discovery ----------

function walkHtml(dir: string, onFile: (file: string) => void): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.test(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, onFile);
    else if (HTML_RE.test(entry.name)) onFile(full);
  }
}

/** File path → route. `index.html` collapses to its dir; ".html" stripped; leading "/". */
function routeFromHtmlFile(root: string, file: string): string {
  const rel = relative(root, file).split(sep).join("/").replace(HTML_RE, "");
  const segs = rel.split("/").filter(Boolean);
  if (segs[segs.length - 1] === "index") segs.pop();
  const route = "/" + segs.join("/");
  return route.length > 1 ? route.replace(/\/+$/, "") : "/";
}

function titleFromHtmlFile(route: string, file: string): string {
  // Prefer the page's <title>, else derive from the route's last segment.
  const m = safeRead(file).match(/<title[^>]*>([^<]+)<\/title>/i);
  if (m && m[1].trim()) return m[1].trim();
  if (route === "/") return "Home";
  const last = route.split("/").filter(Boolean).pop() ?? route;
  return last.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function safeRead(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

// ---------- parsing (regex scan) ----------

const FEATURE_RULES: Array<{ re: RegExp; kind: RawFeature["kind"]; label: (m: RegExpMatchArray) => string }> = [
  { re: /<button\b[^>]*>([^<]*)/i, kind: "button", label: (m) => m[1].trim() || "Button" },
  { re: /<(?:input|textarea|select)\b[^>]*\bplaceholder=["']([^"']*)["']/i, kind: "input", label: (m) => m[1] || "Input" },
  { re: /<(?:input|textarea|select)\b/i, kind: "input", label: () => "Input" },
  { re: /<form\b/i, kind: "form", label: () => "Form" },
];

const HREF = /<a\b[^>]*?\shref=["']([^"'#]+)["']/i;
const FORM_ACTION = /<form\b[^>]*?\saction=["']([^"']+)["']/i;
const FETCH = /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]/;

/** `routeBase` is the page's own route, used to resolve relative <a href> into absolute route ids. */
function parseHtml(src: string, routeBase: string): RawScreen {
  const navs: RawNav[] = [];
  const calls: RawCall[] = [];
  const features: RawFeature[] = [];

  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNo = i + 1;

    const href = line.match(HREF);
    if (href) {
      const target = resolveHref(href[1], routeBase);
      navs.push({ target, raw: snippet(line), trigger: "<a href>", line: lineNo });
    }

    const action = line.match(FORM_ACTION);
    if (action) calls.push({ url: action[1], method: "POST", raw: snippet(line), trigger: "<form action>", line: lineNo });

    const fetchM = line.match(FETCH);
    if (fetchM) calls.push({ url: fetchM[1], raw: snippet(line), trigger: "fetch", line: lineNo });

    for (const rule of FEATURE_RULES) {
      const m = line.match(rule.re);
      if (m) {
        features.push({ kind: rule.kind, label: rule.label(m), detail: m[0].trim().slice(0, 40), line: lineNo });
        break;
      }
    }
  }

  return { navs, calls, features, components: [], contains: [] };
}

/**
 * Resolve an <a href> to a screen-route id so transitions match other pages.
 * External URLs pass through untouched; otherwise strip ".html"/query, resolve relative to the
 * page's route dir, and collapse a trailing "index".
 */
function resolveHref(href: string, routeBase: string): string {
  if (/^https?:\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("tel:")) return href;
  const clean = href.split(/[?#]/)[0].replace(HTML_RE, "");
  if (!clean) return routeBase;
  const baseDir = routeBase === "/" ? "/" : routeBase.replace(/\/[^/]*$/, "") || "/";
  const abs = clean.startsWith("/") ? clean : posix.join(baseDir, clean);
  const segs = abs.split("/").filter(Boolean);
  if (segs[segs.length - 1] === "index") segs.pop();
  const route = "/" + segs.join("/");
  return route.length > 1 ? route.replace(/\/+$/, "") : "/";
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? flat.slice(0, 77) + "..." : flat;
}
