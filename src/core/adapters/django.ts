import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * Django adapter (Python, server-rendered). A screen is a URL route; its signals span three files:
 *   urls.py (route + name + view ref) → views.py (the template it renders + data calls) → template (links).
 *
 * Because template links reference route *names* (`{% url 'blog_detail' %}`), not paths, discover()
 * builds the cross-file maps once (urlName→route, route→view, route→template) and stashes them in
 * module state so parse() can resolve a name into the route it targets.
 *
 *  - screen id = the full URL route (includes are joined with their prefix), e.g. "/blog/<int:id>/".
 *  - nav: template `{% url 'name' %}` / `<a href="/path/">`; view `redirect('name'|'/path/')`.
 *  - call: view `requests.get('url')` / `Model.objects.…` ORM; template `<form action>`.
 *  - feature: template `<button>`, `<input|textarea|select>`, `<form>`.
 */

interface RouteInfo {
  route: string;
  name: string | null;
  viewFile: string | null;
  viewFn: string | null;
  templateFile: string | null;
}

// Cross-file maps, rebuilt each discover() and read by parse().
let urlNameToRoute = new Map<string, string>();
let routeToInfo = new Map<string, RouteInfo>();

export const djangoAdapter: FrameworkAdapter = {
  id: "django",
  router: "django-urls",

  detect(projectRoot) {
    if (existsSync(join(projectRoot, "manage.py"))) return true;
    let found = false;
    walkPy(projectRoot, (file) => {
      if (found) return;
      if (file.endsWith("urls.py") && /\burlpatterns\s*=/.test(safeRead(file))) found = true;
    });
    return found;
  },

  discover(projectRoot) {
    urlNameToRoute = new Map();
    routeToInfo = new Map();

    // Pass A: read every urls.py — its pattern entries and the modules it include()s.
    const urlFiles = new Map<string, UrlModule>();
    walkPy(projectRoot, (file) => {
      if (file.endsWith("urls.py")) urlFiles.set(modulePath(projectRoot, file), parseUrlsFile(safeRead(file), file));
    });

    // include('blog.urls') references a dotted module; match it to a urlFiles key by dotted suffix.
    const resolveInclude = (mod: string): string | null => {
      if (urlFiles.has(mod)) return mod;
      const suffix = mod.replace(/\./g, "/");
      for (const key of urlFiles.keys()) if (key.replace(/\./g, "/").endsWith(suffix)) return key;
      return null;
    };

    // Roots = urls.py modules not pulled in by another's include().
    const included = new Set<string>();
    for (const mod of urlFiles.values())
      for (const inc of mod.includes) {
        const k = resolveInclude(inc.module);
        if (k) included.add(k);
      }
    const roots = [...urlFiles.entries()].filter(([m]) => !included.has(m));

    const files: ScreenFile[] = [];
    const usedRelPaths = new Set<string>();
    const emit = (info: RouteInfo) => {
      if (routeToInfo.has(info.route)) return; // first declaration wins
      routeToInfo.set(info.route, info);
      if (info.name) urlNameToRoute.set(info.name, info.route);
      // Prefer the template as the screen's file (1:1 with the route). Many routes share one
      // views.py, so relPath must stay unique — it's the pipeline's per-screen key — disambiguate
      // a collision with the route.
      const repr = info.templateFile ?? info.viewFile ?? join(projectRoot, "urls.py");
      let relPath = relative(projectRoot, repr).split(sep).join("/");
      if (usedRelPaths.has(relPath)) relPath = `${relPath}#${info.route}`;
      usedRelPaths.add(relPath);
      files.push({
        absPath: repr,
        relPath,
        id: info.route,
        route: info.route,
        title: titleFromRoute(info.route, info.name),
        isEntry: info.route === "/",
      });
    };

    const expand = (moduleName: string, prefix: string, seen: Set<string>) => {
      if (seen.has(moduleName)) return; // guard against cyclic includes
      seen.add(moduleName);
      const mod = urlFiles.get(moduleName);
      if (!mod) return;
      for (const p of mod.patterns) {
        const route = joinRoute(prefix, p.path);
        const view = p.view ? resolveView(projectRoot, mod.file, p.view) : null;
        emit({
          route,
          name: p.name,
          viewFile: view?.file ?? null,
          viewFn: view?.fn ?? null,
          templateFile: p.templateName
            ? resolveTemplate(projectRoot, p.templateName)
            : view
              ? resolveTemplate(projectRoot, templateOfView(view.file, view.fn))
              : null,
        });
      }
      for (const inc of mod.includes) {
        const k = resolveInclude(inc.module);
        if (k) expand(k, joinRoute(prefix, inc.path), seen);
      }
    };

    for (const [moduleName] of roots) expand(moduleName, "", new Set());
    files.sort((a, b) => a.route.localeCompare(b.route));
    return files;
  },

  parse(file) {
    const info = routeToInfo.get(file.id);
    const viewSrc = info?.viewFile && info.viewFn ? viewBody(safeRead(info.viewFile), info.viewFn) : "";
    const templateSrc = info?.templateFile ? safeRead(info.templateFile) : "";
    return parseDjango(viewSrc, templateSrc);
  },
};

// ---------- urls.py parsing ----------

interface UrlPattern {
  path: string;
  view: string | null; // "views.home" / "home" / "HomeView" (.as_view() stripped)
  name: string | null;
  templateName: string | null; // TemplateView.as_view(template_name='x.html')
}
interface UrlModule {
  file: string;
  patterns: UrlPattern[];
  includes: Array<{ path: string; module: string }>;
}

const PATH_CALL = /\b(?:path|re_path|url)\s*\(\s*r?["']([^"']*)["']\s*,\s*([\s\S]*?)\)\s*,?/g;
const NAME_KW = /name\s*=\s*["']([^"']+)["']/;
const TEMPLATE_NAME_KW = /template_name\s*=\s*["']([^"']+)["']/;
const INCLUDE_CALL = /include\s*\(\s*["']([^"']+)["']/;

function parseUrlsFile(src: string, file: string): UrlModule {
  const patterns: UrlPattern[] = [];
  const includes: Array<{ path: string; module: string }> = [];

  for (const m of src.matchAll(PATH_CALL)) {
    const routePath = m[1];
    const rest = m[2];
    const inc = rest.match(INCLUDE_CALL);
    if (inc) {
      includes.push({ path: routePath, module: inc[1] });
      continue;
    }
    const name = rest.match(NAME_KW)?.[1] ?? null;
    const templateName = rest.match(TEMPLATE_NAME_KW)?.[1] ?? null;
    // View ref = the first token of `rest` before a comma: `views.home`, `home`, `HomeView.as_view()`.
    const viewToken = rest.split(",")[0].trim().replace(/\.as_view\s*\([^)]*\)\s*$/, "");
    const view = /^[A-Za-z_][\w.]*$/.test(viewToken) ? viewToken : null;
    patterns.push({ path: routePath, view, name, templateName });
  }
  return { file, patterns, includes };
}

// ---------- view → template + data calls ----------

/** Resolve a urls.py view ref ("views.home" / "home") to (file, fn). Searches *.py for `def fn(`. */
function resolveView(projectRoot: string, urlsFile: string, ref: string): { file: string; fn: string } | null {
  const fn = ref.includes(".") ? ref.slice(ref.lastIndexOf(".") + 1) : ref;
  // Class-based views are PascalCase; we still record the fn but template resolution will fall back.
  const defRe = new RegExp(`\\b(?:def|class)\\s+${fn}\\b`);
  // Prefer a views.py next to the urls.py, else any .py under the project.
  const sibling = join(urlsFile.slice(0, urlsFile.lastIndexOf(sep)), "views.py");
  if (existsSync(sibling) && defRe.test(safeRead(sibling))) return { file: sibling, fn };
  let hit: { file: string; fn: string } | null = null;
  walkPy(projectRoot, (file) => {
    if (hit || !file.endsWith(".py")) return;
    if (defRe.test(safeRead(file))) hit = { file, fn };
  });
  return hit;
}

/** The template a view renders: `render(request, 'x.html')` / `return render(..., "x.html")`. */
function templateOfView(file: string, fn: string): string | null {
  const body = viewBody(safeRead(file), fn);
  const m = body.match(/render\s*\(\s*request\s*,\s*["']([^"']+)["']/) ?? body.match(/render\s*\(\s*[^,]+,\s*["']([^"']+\.html)["']/);
  return m ? m[1] : null;
}

/** Resolve a template name ("blog/list.html") to a file under any `templates/` dir. */
function resolveTemplate(projectRoot: string, name: string | null): string | null {
  if (!name) return null;
  let hit: string | null = null;
  walkAll(projectRoot, (file) => {
    if (hit) return;
    const norm = file.split(sep).join("/");
    if (norm.endsWith("/templates/" + name) || norm.endsWith("/" + name)) {
      if (norm.includes("/templates/")) hit = file;
      else if (!hit) hit = file; // weaker match
    }
  });
  return hit;
}

/** Body of `def fn(` / `class fn(` up to the next top-level def/class (indentation 0). */
function viewBody(src: string, fn: string): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\s*(?:def|class)\\s+${fn}\\b`).test(l));
  if (start < 0) return "";
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && /^(?:def|class|@)\b/.test(lines[i])) break; // next top-level decl
    out.push(lines[i]);
  }
  return out.join("\n");
}

// ---------- signal extraction (view body + template) ----------

const URL_TAG = /\{%\s*url\s+["']([^"']+)["']/;
const HREF = /<a\b[^>]*?\shref=["']([^"'#{]+)["']/i;
const REDIRECT = /\bredirect\s*\(\s*["']([^"']+)["']/;
const HTTP_CALL = /\brequests\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/;
const ORM_CALL = /\b([A-Z]\w*)\.objects\.(all|filter|get|create|count|exclude)\b/;
const FORM_ACTION = /<form\b[^>]*?\saction=["']([^"']+)["']/i;

const FEATURE_RULES: Array<{ re: RegExp; kind: RawFeature["kind"]; label: (m: RegExpMatchArray) => string }> = [
  { re: /<button\b[^>]*>([^<]*)/i, kind: "button", label: (m) => m[1].trim() || "Button" },
  { re: /<(?:input|textarea|select)\b[^>]*\bplaceholder=["']([^"']*)["']/i, kind: "input", label: (m) => m[1] || "Input" },
  { re: /<(?:input|textarea|select)\b/i, kind: "input", label: () => "Input" },
  { re: /<form\b/i, kind: "form", label: () => "Form" },
];

function parseDjango(viewSrc: string, templateSrc: string): RawScreen {
  const navs: RawNav[] = [];
  const calls: RawCall[] = [];
  const features: RawFeature[] = [];

  // --- view body: redirects + data calls ---
  viewSrc.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    const red = line.match(REDIRECT);
    if (red) navs.push({ target: resolveTarget(red[1]), raw: snippet(line), trigger: "redirect()", line: i + 1 });
    const httpM = line.match(HTTP_CALL);
    if (httpM) calls.push({ url: httpM[2], method: httpM[1].toUpperCase(), raw: snippet(line), trigger: "requests", line: i + 1 });
    const orm = line.match(ORM_CALL);
    if (orm) calls.push({ url: `${orm[1]}.${orm[2]}`, raw: snippet(line), trigger: "orm", line: i + 1 });
  });

  // --- template: {% url %} + <a href> nav, <form action> calls, features ---
  templateSrc.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    const urlTag = line.match(URL_TAG);
    if (urlTag) navs.push({ target: urlNameToRoute.get(urlTag[1]) ?? null, raw: snippet(line), trigger: "{% url %}", line: i + 1 });
    else {
      const href = line.match(HREF);
      if (href) navs.push({ target: resolveTarget(href[1]), raw: snippet(line), trigger: "<a href>", line: i + 1 });
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

/** A redirect/href target: a URL name (resolve via the map) or a literal path. */
function resolveTarget(raw: string): string | null {
  if (raw.startsWith("/")) return normalize(raw);
  return urlNameToRoute.get(raw) ?? null;
}

// ---------- helpers ----------

function joinRoute(prefix: string, path: string): string {
  const combined = (prefix + path).replace(/\/{2,}/g, "/");
  let r = combined.startsWith("/") ? combined : "/" + combined;
  if (r.length > 1) r = r.replace(/\/+$/, "/"); // keep a single trailing slash (Django convention)
  return r === "" ? "/" : r;
}

function normalize(path: string): string {
  let r = path.startsWith("/") ? path : "/" + path;
  r = r.replace(/\/{2,}/g, "/");
  return r;
}

function titleFromRoute(route: string, name: string | null): string {
  if (route === "/") return "Home";
  const base = name ?? route.split("/").filter((s) => s && !s.startsWith("<")).pop() ?? route;
  return base.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Dotted module ("blog.urls") → resolved urls.py file key (project-relative module path). */
function modulePath(projectRoot: string, file: string): string {
  return relative(projectRoot, file).replace(/\.py$/, "").split(sep).join(".");
}

function walkPy(dir: string, onFile: (file: string) => void): void {
  walkExt(dir, [".py"], onFile);
}
function walkAll(dir: string, onFile: (file: string) => void): void {
  walkExt(dir, [".html", ".py"], onFile);
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
