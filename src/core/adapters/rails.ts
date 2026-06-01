import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * Ruby on Rails adapter (server-rendered). A screen is a URL route declared in `config/routes.rb`;
 * its signals span the controller action (Ruby) and its view (ERB). Like django/flask, view links
 * reference route *names* — Rails path helpers (`posts_path`, `post_path`) — so discover() builds a
 * helper→route map for parse() to resolve.
 *
 *  - routes: explicit `get '/x', to: 'c#a'` / `get '/x' => 'c#a'`; `root 'c#a'`; and `resources :posts`
 *    (expanded to index/new/create/show/edit/update/destroy) / `resource :profile` (singular).
 *  - screen id = the URL path ("/posts/:id"); the view file = app/views/<controller>/<action>.html.erb.
 *  - nav: view `link_to 'x', posts_path` / `<a href>`; controller `redirect_to posts_path|'/path'`.
 *  - call: controller ActiveRecord `Post.all|where|find|create…` + `Net::HTTP`/`HTTParty`.
 *  - feature: view `<button>`, `form_with`/`form_for`/`<form>`, `<input|textarea|select>`.
 */

interface RouteInfo {
  route: string;
  controller: string;
  action: string;
  helpers: string[]; // path-helper names that target this route (e.g. ["posts", "post"])
  viewFile: string | null;
}

// path-helper name (without the _path/_url suffix) → route, rebuilt each discover() and read by parse().
let helperToRoute = new Map<string, string>();
let routeToInfo = new Map<string, RouteInfo>();

export const railsAdapter: FrameworkAdapter = {
  id: "rails",
  router: "rails-routes",

  detect(projectRoot) {
    if (existsSync(join(projectRoot, "config", "routes.rb"))) return true;
    const gemfile = join(projectRoot, "Gemfile");
    return existsSync(gemfile) && /\bgem\s+["']rails["']/.test(safeRead(gemfile));
  },

  discover(projectRoot) {
    helperToRoute = new Map();
    routeToInfo = new Map();

    const routesFile = findRoutesFile(projectRoot);
    if (!routesFile) return [];
    const routes = parseRoutes(safeRead(routesFile));

    const files: ScreenFile[] = [];
    const usedRelPaths = new Set<string>();
    for (const r of routes) {
      if (routeToInfo.has(r.route)) continue; // first declaration wins
      const viewFile = resolveView(projectRoot, r.controller, r.action);
      const info: RouteInfo = { ...r, viewFile };
      routeToInfo.set(r.route, info);
      for (const h of r.helpers) helperToRoute.set(h, r.route);

      const repr = viewFile ?? join(projectRoot, "config", "routes.rb");
      let relPath = relative(projectRoot, repr).split(sep).join("/");
      if (usedRelPaths.has(relPath)) relPath = `${relPath}#${r.route}`;
      usedRelPaths.add(relPath);
      files.push({
        absPath: repr,
        relPath,
        id: r.route,
        route: r.route,
        title: titleFromRoute(r.route, `${r.controller}#${r.action}`),
        isEntry: r.route === "/",
      });
    }
    files.sort((a, b) => a.route.localeCompare(b.route));
    return files;
  },

  parse(file) {
    const info = routeToInfo.get(file.id);
    const controllerSrc = info ? actionBody(controllerFile(file, info), info.action) : "";
    const viewSrc = info?.viewFile ? safeRead(info.viewFile) : "";
    return parseRails(controllerSrc, viewSrc);
  },
};

// ---------- routes.rb parsing ----------

interface RawRoute {
  route: string;
  controller: string;
  action: string;
  helpers: string[];
}

const ROOT_RE = /^root\s+(?:to:\s*)?["']([\w/]+)#(\w+)["']/;
const VERB_RE = /^(?:get|post|put|patch|delete)\s+["']([^"']+)["']\s*(?:,\s*(?:to:\s*)?|=>\s*)["']([\w/]+)#(\w+)["']/;
const RESOURCES_RE = /^resources?\s+:(\w+)/;
const RESOURCE_SINGULAR_RE = /^resource\s+:(\w+)/;

function parseRoutes(src: string): RawRoute[] {
  const out: RawRoute[] = [];
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const root = line.match(ROOT_RE);
    if (root) {
      out.push({ route: "/", controller: root[1], action: root[2], helpers: ["root"] });
      continue;
    }
    const verb = line.match(VERB_RE);
    if (verb) {
      const path = normalize(verb[1]);
      out.push({ route: path, controller: verb[2], action: verb[3], helpers: [helperFromPath(path)] });
      continue;
    }
    const res = line.match(RESOURCES_RE);
    if (res && !RESOURCE_SINGULAR_RE.test(line)) {
      out.push(...expandResources(res[1]));
      continue;
    }
    const sres = line.match(RESOURCE_SINGULAR_RE);
    if (sres) out.push(...expandSingularResource(sres[1]));
  }
  return out;
}

/** `resources :posts` → the 7 RESTful routes with their path helpers. */
function expandResources(name: string): RawRoute[] {
  const c = name; // controller = plural resource name
  const singular = singularize(name);
  return [
    { route: `/${name}`, controller: c, action: "index", helpers: [name] },
    { route: `/${name}/new`, controller: c, action: "new", helpers: [`new_${singular}`] },
    { route: `/${name}/:id`, controller: c, action: "show", helpers: [singular] },
    { route: `/${name}/:id/edit`, controller: c, action: "edit", helpers: [`edit_${singular}`] },
  ];
}

/** `resource :profile` (singular) → show/new/edit (no index, no :id). */
function expandSingularResource(name: string): RawRoute[] {
  const plural = name + "s";
  return [
    { route: `/${name}`, controller: plural, action: "show", helpers: [name] },
    { route: `/${name}/new`, controller: plural, action: "new", helpers: [`new_${name}`] },
    { route: `/${name}/edit`, controller: plural, action: "edit", helpers: [`edit_${name}`] },
  ];
}

// ---------- controller + view resolution ----------

function findRoutesFile(projectRoot: string): string | null {
  const f = join(projectRoot, "config", "routes.rb");
  if (existsSync(f)) return f;
  let hit: string | null = null;
  walkRb(projectRoot, (file) => {
    if (!hit && file.endsWith("routes.rb")) hit = file;
  });
  return hit;
}

/** app/views/<controller>/<action>.html.erb (also .erb / .haml fallbacks). */
function resolveView(projectRoot: string, controller: string, action: string): string | null {
  const bases = [
    join(projectRoot, "app", "views", controller, action),
    join(projectRoot, "views", controller, action),
  ];
  const exts = [".html.erb", ".html.haml", ".erb", ".haml"];
  for (const b of bases) for (const e of exts) if (existsSync(b + e)) return b + e;
  return null;
}

/** app/controllers/<controller>_controller.rb. */
function controllerFile(file: ScreenFile, info: RouteInfo): string {
  // viewFile path: …/app/views/<controller>/<action>… → …/app/controllers/<controller>_controller.rb
  const abs = file.absPath;
  const viewsIdx = abs.lastIndexOf(`${sep}views${sep}`);
  if (viewsIdx >= 0) {
    const appRoot = abs.slice(0, viewsIdx);
    const cf = join(appRoot, "controllers", `${info.controller}_controller.rb`);
    if (existsSync(cf)) return cf;
  }
  return "";
}

/** Body of `def <action>` up to the matching `end` (simple indent-agnostic: next `def`/class `end`). */
function actionBody(controllerPath: string, action: string): string {
  if (!controllerPath) return "";
  const lines = safeRead(controllerPath).split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\s*def\\s+${action}\\b`).test(l));
  if (start < 0) return "";
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*def\s+\w/.test(lines[i])) break; // next action
    out.push(lines[i]);
  }
  return out.join("\n");
}

// ---------- signal extraction (controller action + view ERB) ----------

const LINK_TO = /\blink_to\b[^,]*,\s*(\w+)_(?:path|url)\b/; // link_to 'x', posts_path
const LINK_TO_LITERAL = /\blink_to\b[^,]*,\s*["'](\/[^"']*)["']/;
const HREF = /<a\b[^>]*?\shref=["']([^"'#<]+)["']/i;
const REDIRECT_HELPER = /\bredirect_to\s+(\w+)_(?:path|url)\b/;
const REDIRECT_LITERAL = /\bredirect_to\s+["'](\/[^"']*)["']/;
const HTTP_CALL = /\b(?:Net::HTTP|HTTParty|Faraday)[.\w]*\.(get|post|put|delete)\b|\bHTTParty\.(get|post)\s*\(\s*["']([^"']+)["']/;
const AR_CALL = /\b([A-Z]\w*)\.(all|where|find|find_by|create|count|first|last)\b/;

const FEATURE_RULES: Array<{ re: RegExp; kind: RawFeature["kind"]; label: (m: RegExpMatchArray) => string }> = [
  { re: /<button\b[^>]*>([^<]*)/i, kind: "button", label: (m) => m[1].trim() || "Button" },
  { re: /\bsubmit\b/i, kind: "button", label: () => "Submit" },
  { re: /<(?:input|textarea|select)\b/i, kind: "input", label: () => "Input" },
  { re: /\b(?:text_field|text_area|select|number_field|email_field)\b/, kind: "input", label: () => "Input" },
  { re: /\b(?:form_with|form_for|form_tag)\b|<form\b/i, kind: "form", label: () => "Form" },
];

function parseRails(controllerSrc: string, viewSrc: string): RawScreen {
  const navs: RawNav[] = [];
  const calls: RawCall[] = [];
  const features: RawFeature[] = [];

  // --- controller action: redirects + ActiveRecord / HTTP calls ---
  controllerSrc.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    const redH = line.match(REDIRECT_HELPER);
    const redL = line.match(REDIRECT_LITERAL);
    if (redH) navs.push({ target: helperToRoute.get(redH[1]) ?? null, raw: snippet(line), trigger: "redirect_to", line: i + 1 });
    else if (redL) navs.push({ target: normalize(redL[1]), raw: snippet(line), trigger: "redirect_to", line: i + 1 });
    const ar = line.match(AR_CALL);
    if (ar) calls.push({ url: `${ar[1]}.${ar[2]}`, raw: snippet(line), trigger: "activerecord", line: i + 1 });
    const httpM = line.match(HTTP_CALL);
    if (httpM) calls.push({ url: httpM[3] ?? null, method: (httpM[1] ?? httpM[2] ?? "GET").toUpperCase(), raw: snippet(line), trigger: "http", line: i + 1 });
  });

  // --- view ERB: link_to / <a href> nav, form features ---
  viewSrc.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    const linkH = line.match(LINK_TO);
    const linkL = line.match(LINK_TO_LITERAL);
    const href = line.match(HREF);
    if (linkH) navs.push({ target: helperToRoute.get(linkH[1]) ?? null, raw: snippet(line), trigger: "link_to", line: i + 1 });
    else if (linkL) navs.push({ target: normalize(linkL[1]), raw: snippet(line), trigger: "link_to", line: i + 1 });
    else if (href) navs.push({ target: normalize(href[1]), raw: snippet(line), trigger: "<a href>", line: i + 1 });
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

function helperFromPath(path: string): string {
  // "/about" → "about"; "/" → "root"; strip params, join segments with _.
  const segs = path.split("/").filter((s) => s && !s.startsWith(":"));
  return segs.length ? segs.join("_") : "root";
}

function singularize(name: string): string {
  if (name.endsWith("ies")) return name.slice(0, -3) + "y";
  if (name.endsWith("ses")) return name.slice(0, -2);
  if (name.endsWith("s")) return name.slice(0, -1);
  return name;
}

function normalize(path: string): string {
  let r = path.startsWith("/") ? path : "/" + path;
  r = r.replace(/\/{2,}/g, "/");
  return r.length > 1 ? r.replace(/\/+$/, "") : "/";
}

function titleFromRoute(route: string, ca: string): string {
  if (route === "/") return "Home";
  const last = route.split("/").filter((s) => s && !s.startsWith(":")).pop() ?? ca;
  return last.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function walkRb(dir: string, onFile: (file: string) => void): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "vendor" || entry.name === "tmp") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkRb(full, onFile);
    else if (entry.name.endsWith(".rb")) onFile(full);
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
