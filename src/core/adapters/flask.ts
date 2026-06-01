import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * Flask adapter (Python, server-rendered). Like Django, a screen is a URL route whose signals span
 * the view (Python) and its template (Jinja). The discovery front end differs: routes are declared
 * by `@app.route('/path')` / `@bp.route('/path')` decorators on view functions, and template links
 * reference the *endpoint* (the function name) via `url_for('endpoint')` — so discover() builds an
 * endpoint→route map for parse() to resolve.
 *
 *  - screen id = the route path (blueprint url_prefix joined in), e.g. "/blog/<int:id>".
 *  - nav: template `{{ url_for('endpoint') }}` / `<a href="/path">`; view `redirect(url_for('e'))` or `redirect('/path')`.
 *  - call: view `requests.get('url')` + SQLAlchemy `Model.query.…`; template `<form action>`.
 *  - feature: template `<button>`, `<input|textarea|select>`, `<form>`.
 */

interface RouteInfo {
  route: string;
  endpoint: string; // what url_for references: `<fn>` or `<blueprint>.<fn>`
  fn: string; // the bare view-function name (for finding its body)
  viewFile: string;
  template: string | null;
  templateFile: string | null;
}

// endpoint(view-fn name) → route, rebuilt each discover() and read by parse().
let endpointToRoute = new Map<string, string>();
let routeToInfo = new Map<string, RouteInfo>();

export const flaskAdapter: FrameworkAdapter = {
  id: "flask",
  router: "flask-routes",

  detect(projectRoot) {
    let found = false;
    walkPy(projectRoot, (file) => {
      if (found) return;
      const src = safeRead(file);
      if (/\bFlask\s*\(\s*__name__/.test(src) || /@(?:app|bp|\w+)\.route\s*\(/.test(src)) found = true;
    });
    return found;
  },

  discover(projectRoot) {
    endpointToRoute = new Map();
    routeToInfo = new Map();
    const files: ScreenFile[] = [];
    const usedRelPaths = new Set<string>();

    walkPy(projectRoot, (file) => {
      const src = safeRead(file);
      const blueprints = blueprintInfo(src); // Blueprint var → {name, url_prefix}
      for (const r of routesInFile(src, file, blueprints)) {
        if (routeToInfo.has(r.route)) continue; // first declaration wins
        // Resolve the template now so it's the screen's file (1:1 with the route) and its relPath key.
        if (r.template) r.templateFile = resolveTemplate(projectRoot, r.template);
        routeToInfo.set(r.route, r);
        endpointToRoute.set(r.endpoint, r.route);
        const repr = r.templateFile ?? r.viewFile;
        let relPath = relative(projectRoot, repr).split(sep).join("/");
        if (usedRelPaths.has(relPath)) relPath = `${relPath}#${r.route}`;
        usedRelPaths.add(relPath);
        files.push({
          absPath: repr,
          relPath,
          id: r.route,
          route: r.route,
          title: titleFromRoute(r.route, r.endpoint),
          isEntry: r.route === "/",
        });
      }
    });

    files.sort((a, b) => a.route.localeCompare(b.route));
    return files;
  },

  parse(file) {
    const info = routeToInfo.get(file.id);
    const viewSrc = info ? viewBody(safeRead(info.viewFile), info.fn) : "";
    const templateSrc = info?.templateFile ? safeRead(info.templateFile) : "";
    return parseFlask(viewSrc, templateSrc);
  },
};

// ---------- route discovery ----------

const ROUTE_DECORATOR = /@(\w+)\.route\s*\(\s*["']([^"']+)["']/;
const DEF_LINE = /^def\s+(\w+)\s*\(/;
const RENDER = /render_template\s*\(\s*["']([^"']+)["']/;
// `bp = Blueprint("blog", __name__, url_prefix="/blog")` — name is the 1st arg, url_prefix optional.
const BLUEPRINT = /(\w+)\s*=\s*Blueprint\s*\(\s*["']([^"']+)["'][^)]*?(?:url_prefix\s*=\s*["']([^"']+)["'])?\s*\)/g;

interface Blueprint {
  name: string; // blueprint name — endpoints are `<name>.<fn>`
  prefix: string; // url_prefix joined onto each route
}

/** Blueprint variable → {name, url_prefix}. A `@bp.route('/x')` becomes route `<prefix>/x`, endpoint `<name>.<fn>`. */
function blueprintInfo(src: string): Map<string, Blueprint> {
  const map = new Map<string, Blueprint>();
  for (const m of src.matchAll(BLUEPRINT)) map.set(m[1], { name: m[2], prefix: m[3] ?? "" });
  return map;
}

/** Every `@x.route('/path')`-decorated view fn in a file → its route + endpoint + template. */
function routesInFile(src: string, file: string, blueprints: Map<string, Blueprint>): RouteInfo[] {
  const lines = src.split(/\r?\n/);
  const out: RouteInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const dec = lines[i].trim().match(ROUTE_DECORATOR);
    if (!dec) continue;
    const decoratorVar = dec[1];
    const path = dec[2];
    // The decorated function is the next `def` line (skipping additional decorators).
    let j = i + 1;
    while (j < lines.length && /^\s*@/.test(lines[j])) j++;
    const defM = lines[j]?.trim().match(DEF_LINE);
    if (!defM) continue;
    const fn = defM[1];
    const bp = blueprints.get(decoratorVar);
    // Blueprint routes carry the prefix on the path and a `<bpName>.<fn>` endpoint (how url_for refers to them).
    const route = joinRoute(bp?.prefix ?? "", path);
    const endpoint = bp ? `${bp.name}.${fn}` : fn;
    const template = templateOfBody(lines, j);
    out.push({ route, endpoint, fn, viewFile: file, template, templateFile: null });
  }
  return out;
}

/** First render_template('x.html') in the fn body (from its def line to the next top-level def). */
function templateOfBody(lines: string[], defLine: number): string | null {
  for (let i = defLine; i < lines.length; i++) {
    if (i > defLine && /^\S/.test(lines[i]) && /^(?:def|@)\b/.test(lines[i].trim())) break;
    const m = lines[i].match(RENDER);
    if (m) return m[1];
  }
  return null;
}

/** Resolve a Jinja template name to a file under any `templates/` dir. */
function resolveTemplate(projectRoot: string, name: string): string | null {
  let hit: string | null = null;
  walkExt(projectRoot, [".html"], (file) => {
    if (hit) return;
    const norm = file.split(sep).join("/");
    if (norm.endsWith("/templates/" + name) || norm.endsWith("/" + name)) hit = file;
  });
  return hit;
}

/** Body of view fn `endpoint` — its def line to the next top-level def/decorator. */
function viewBody(src: string, endpoint: string): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^def\\s+${endpoint}\\s*\\(`).test(l));
  if (start < 0) return "";
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && /^(?:def|@)\b/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

// ---------- signal extraction (view body + template) ----------

const URL_FOR = /\burl_for\s*\(\s*["']([^"']+)["']/;
const HREF = /<a\b[^>]*?\shref=["']([^"'#{]+)["']/i;
const REDIRECT_URLFOR = /\bredirect\s*\(\s*url_for\s*\(\s*["']([^"']+)["']/;
const REDIRECT_PATH = /\bredirect\s*\(\s*["'](\/[^"']*)["']/;
const HTTP_CALL = /\brequests\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/;
const QUERY_CALL = /\b([A-Z]\w*)\.query\.(all|filter|filter_by|get|get_or_404|first|count)\b/;
const FORM_ACTION = /<form\b[^>]*?\saction=["']([^"']+)["']/i;

const FEATURE_RULES: Array<{ re: RegExp; kind: RawFeature["kind"]; label: (m: RegExpMatchArray) => string }> = [
  { re: /<button\b[^>]*>([^<]*)/i, kind: "button", label: (m) => m[1].trim() || "Button" },
  { re: /<(?:input|textarea|select)\b[^>]*\bplaceholder=["']([^"']*)["']/i, kind: "input", label: (m) => m[1] || "Input" },
  { re: /<(?:input|textarea|select)\b/i, kind: "input", label: () => "Input" },
  { re: /<form\b/i, kind: "form", label: () => "Form" },
];

function parseFlask(viewSrc: string, templateSrc: string): RawScreen {
  const navs: RawNav[] = [];
  const calls: RawCall[] = [];
  const features: RawFeature[] = [];

  // --- view body: redirects + data calls ---
  viewSrc.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    const redFor = line.match(REDIRECT_URLFOR);
    const redPath = line.match(REDIRECT_PATH);
    if (redFor) navs.push({ target: endpointToRoute.get(redFor[1]) ?? null, raw: snippet(line), trigger: "redirect()", line: i + 1 });
    else if (redPath) navs.push({ target: normalize(redPath[1]), raw: snippet(line), trigger: "redirect()", line: i + 1 });
    const httpM = line.match(HTTP_CALL);
    if (httpM) calls.push({ url: httpM[2], method: httpM[1].toUpperCase(), raw: snippet(line), trigger: "requests", line: i + 1 });
    const q = line.match(QUERY_CALL);
    if (q) calls.push({ url: `${q[1]}.${q[2]}`, raw: snippet(line), trigger: "query", line: i + 1 });
  });

  // --- template: url_for() + <a href> nav, <form action> calls, features ---
  templateSrc.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    const uf = line.match(URL_FOR);
    if (uf && !/['"]static['"]/.test(uf[0])) {
      navs.push({ target: endpointToRoute.get(uf[1]) ?? null, raw: snippet(line), trigger: "url_for()", line: i + 1 });
    } else {
      const href = line.match(HREF);
      if (href) navs.push({ target: normalize(href[1]), raw: snippet(line), trigger: "<a href>", line: i + 1 });
    }
    const action = line.match(FORM_ACTION);
    if (action) calls.push({ url: action[1], method: "POST", raw: snippet(line), trigger: "<form action>", line: i + 1 });
    for (const rule of FEATURE_RULES) {
      const m = line.match(rule.re);
      if (m) {
        features.push({ kind: rule.kind, label: rule.label(m), detail: m[0].trim().slice(0, 40), line: i + 1 });
        break;
      }
    }
  });

  return { navs, calls, features, components: [], contains: [] };
}

// ---------- helpers ----------

function joinRoute(prefix: string, path: string): string {
  const combined = (prefix + path).replace(/\/{2,}/g, "/");
  let r = combined.startsWith("/") ? combined : "/" + combined;
  if (r.length > 1) r = r.replace(/\/+$/, "");
  return r === "" ? "/" : r;
}

function normalize(path: string): string {
  let r = path.startsWith("/") ? path : "/" + path;
  r = r.replace(/\/{2,}/g, "/");
  return r.length > 1 ? r.replace(/\/+$/, "") : "/";
}

function titleFromRoute(route: string, endpoint: string): string {
  if (route === "/") return "Home";
  const base = endpoint || route.split("/").filter((s) => s && !s.startsWith("<")).pop() || route;
  return base.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function walkPy(dir: string, onFile: (file: string) => void): void {
  walkExt(dir, [".py"], onFile);
}
function walkExt(dir: string, exts: string[], onFile: (file: string) => void): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkExt(full, exts, onFile);
    else if (exts.some((e) => entry.name.endsWith(e))) onFile(full);
  }
}

function safeRead(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? flat.slice(0, 77) + "..." : flat;
}
