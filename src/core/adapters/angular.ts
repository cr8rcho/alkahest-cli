import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep, dirname, resolve } from "node:path";
import { Project, Node, SyntaxKind, ts } from "ts-morph";
import type { SourceFile, ObjectLiteralExpression } from "ts-morph";
import type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * Angular adapter. Routes are *declared* in a TS config — `RouterModule.forRoot([...])` /
 * `forChild([...])` or a standalone `provideRouter([...])` / exported `Routes` array. discover()
 * parses that config with ts-morph, maps each route's `component` (static import) or
 * `loadComponent: () => import('…')` (lazy) to its source file; nested `children` join through
 * parent paths.
 *
 * A component's signals come from its `@Component` template — inline (`template: \`…\``) or an
 * external `templateUrl` html file — plus its TS body:
 *  - nav: `routerLink="/x"` / `[routerLink]="'/x'"` / `[routerLink]="['/x']"` (template);
 *         `router.navigate(['/x'])` / `router.navigateByUrl('/x')` (TS)
 *  - call: `http.get('url')` / `this.http.post('url', …)` etc. (TS)
 *  - feature: `<button>`, `<input|textarea|select>`, `<form>`, `*ngFor` (template)
 *
 * Screen id = full route path ("/users/:id"); entry = "/".
 */
const SOURCE_RE = /\.(ts)$/;
const CONFIG_HINT = /RouterModule\.for(Root|Child)|provideRouter|:\s*Routes\b/;
const EXTS = [".ts"];

function srcRootOf(projectRoot: string): string {
  const src = join(projectRoot, "src");
  return existsSync(src) && statSync(src).isDirectory() ? src : projectRoot;
}

function hasAngularDep(projectRoot: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return "@angular/core" in deps || "@angular/router" in deps;
  } catch {
    return existsSync(join(projectRoot, "angular.json"));
  }
}

interface RouteEntry {
  route: string;
  spec: string | null; // module specifier of the component's .ts file (static or lazy import)
}

let _project: Project | null = null;
function project(): Project {
  if (!_project)
    _project = new Project({
      useInMemoryFileSystem: false,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: { allowJs: true, jsx: ts.JsxEmit.React },
    });
  return _project;
}
function sourceFileFor(absPath: string): SourceFile {
  return project().getSourceFile(absPath) ?? project().addSourceFileAtPath(absPath);
}

export const angularAdapter: FrameworkAdapter = {
  id: "angular",
  router: "angular-router",

  detect(projectRoot) {
    return hasAngularDep(projectRoot);
  },

  discover(projectRoot) {
    const root = srcRootOf(projectRoot);
    const byRoute = new Map<string, ScreenFile>();

    walkTs(root, (file) => {
      const src = safeRead(file);
      if (!CONFIG_HINT.test(src)) return; // cheap pre-filter

      const sf = sourceFileFor(file);
      const entries = routesFromConfig(sf);
      if (entries.length === 0) return;

      const imports = importSpecs(sf);
      const configDir = dirname(file);
      for (const { route, spec } of entries) {
        if (byRoute.has(route)) continue; // first declaration wins
        const abs = spec ? resolveTsFile(configDir, spec) : null;
        if (!abs) continue; // can't open the component → skip
        byRoute.set(route, {
          absPath: abs,
          relPath: relative(projectRoot, abs).split(sep).join("/"),
          id: route,
          route,
          title: titleFromRoute(route),
          isEntry: route === "/",
        });
      }
    });

    return [...byRoute.values()].sort((a, b) => a.route.localeCompare(b.route));
  },

  parse(file) {
    return parseAngularComponent(file.absPath);
  },
};

// ---------- route extraction (ts-morph) ----------

/** Every `Routes`-shaped array literal in the file → flattened routes (paths joined through children). */
function routesFromConfig(sf: SourceFile): RouteEntry[] {
  const out: RouteEntry[] = [];
  const imports = importSpecs(sf);
  const seen = new Set<Node>();
  const handle = (arr: Node | undefined) => {
    if (arr && Node.isArrayLiteralExpression(arr) && !seen.has(arr)) {
      seen.add(arr);
      walkRouteArray(arr, "/", out, imports);
    }
  };

  // forRoot([...]) / forChild([...]) / provideRouter([...]) call arguments
  for (const ce of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = ce.getExpression();
    const name = Node.isPropertyAccessExpression(expr) ? expr.getName() : expr.getText();
    if (name === "forRoot" || name === "forChild" || name === "provideRouter") handle(ce.getArguments()[0]);
  }
  // `const routes: Routes = [...]` and `export const routes = [...]`
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const typeNode = decl.getTypeNode();
    if (typeNode?.getText() === "Routes") handle(decl.getInitializer());
  }
  return out;
}

function walkRouteArray(arr: Node, parentPath: string, out: RouteEntry[], imports: Map<string, string>): void {
  if (!Node.isArrayLiteralExpression(arr)) return;
  for (const el of arr.getElements()) {
    if (Node.isObjectLiteralExpression(el)) walkRouteObject(el, parentPath, out, imports);
  }
}

function walkRouteObject(obj: ObjectLiteralExpression, parentPath: string, out: RouteEntry[], imports: Map<string, string>): void {
  const pathVal = stringProp(obj, "path");
  const route = joinRoute(parentPath, pathVal);
  const spec = componentSpec(obj, imports);
  if (spec || pathVal != null) out.push({ route, spec });

  const childrenProp = obj.getProperty("children");
  if (childrenProp && Node.isPropertyAssignment(childrenProp)) {
    const init = childrenProp.getInitializer();
    if (init) walkRouteArray(init, route, out, imports);
  }
}

/** `component: Home` (static import) or `loadComponent: () => import('./x').then(m => m.X)` → module specifier. */
function componentSpec(obj: ObjectLiteralExpression, imports: Map<string, string>): string | null {
  const comp = obj.getProperty("component");
  if (comp && Node.isPropertyAssignment(comp)) {
    const init = comp.getInitializer();
    if (init && Node.isIdentifier(init)) return imports.get(init.getText()) ?? null;
  }
  const load = obj.getProperty("loadComponent");
  if (load && Node.isPropertyAssignment(load)) {
    const dyn = dynamicImportSpecifier(load.getInitializer());
    if (dyn) return dyn;
  }
  return null;
}

// ---------- component parsing (template + TS) ----------

const ROUTER_LINK = /\brouterLink\b(?:=["']([^"']+)["']|]=["']\[?['"]?(\/[^"'\]]+)['"]?]?["'])/;
const NAVIGATE = /\.navigate(?:ByUrl)?\s*\(\s*\[?\s*["'`]([^"'`]+)["'`]/;
const HTTP_CALL = /\bhttp\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\s*\(\s*["'`]([^"'`]+)["'`]/;
const TEMPLATE_URL = /templateUrl:\s*["'`]([^"'`]+)["'`]/;

const FEATURE_RULES: Array<{ re: RegExp; kind: RawFeature["kind"]; label: (m: RegExpMatchArray) => string }> = [
  { re: /<button\b[^>]*>([^<]*)/i, kind: "button", label: (m) => m[1].trim() || "Button" },
  { re: /<(?:input|textarea|select)\b[^>]*\bplaceholder=["']([^"']*)["']/i, kind: "input", label: (m) => m[1] || "Input" },
  { re: /<(?:input|textarea|select)\b/i, kind: "input", label: () => "Input" },
  { re: /<form\b/i, kind: "form", label: () => "Form" },
  { re: /\*ngFor\b/, kind: "list", label: () => "List" },
];

/** Parse an Angular component file: TS body for navigate()/http calls + its template (inline or templateUrl) for routerLink/features. */
function parseAngularComponent(absPath: string): RawScreen {
  const ts = safeRead(absPath);
  const templateUrlMatch = ts.match(TEMPLATE_URL);
  const externalTemplate = templateUrlMatch ? safeRead(resolve(dirname(absPath), templateUrlMatch[1])) : "";
  // The inline template lives inside the @Component decorator's TS; scanning the whole TS source
  // for routerLink/features covers it without isolating the literal.
  const markup = ts + "\n" + externalTemplate;

  const navs: RawNav[] = [];
  const calls: RawCall[] = [];
  const features: RawFeature[] = [];

  // --- navigation + calls: scan TS lines (navigate/http) ---
  ts.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    const navM = line.match(NAVIGATE);
    if (navM) navs.push({ target: normalizeNav(navM[1]), raw: snippet(line), trigger: "router.navigate", line: i + 1 });
    const httpM = line.match(HTTP_CALL);
    if (httpM) calls.push({ url: httpM[2], method: httpM[1].toUpperCase(), raw: snippet(line), trigger: "http", line: i + 1 });
  });

  // --- routerLink + features: scan combined markup ---
  markup.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    const linkM = line.match(ROUTER_LINK);
    if (linkM) {
      const target = linkM[1] ?? linkM[2] ?? null;
      navs.push({ target: target ? normalizeNav(target) : null, raw: snippet(line), trigger: "routerLink", line: i + 1 });
    }
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

/** `users/42` or `/users` → "/users/42"; arrays already split on the first literal. */
function normalizeNav(target: string): string {
  const t = target.startsWith("/") ? target : "/" + target;
  return t.length > 1 ? t.replace(/\/+$/, "") : "/";
}

// ---------- helpers ----------

function importSpecs(sf: SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    const def = imp.getDefaultImport();
    if (def) map.set(def.getText(), spec);
    for (const n of imp.getNamedImports()) map.set(n.getName(), spec);
  }
  return map;
}

function dynamicImportSpecifier(node: Node | undefined): string | null {
  if (!node) return null;
  for (const ce of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (ce.getExpression().getKind() === SyntaxKind.ImportKeyword) {
      const a = ce.getArguments()[0];
      if (a && Node.isStringLiteral(a)) return a.getLiteralValue();
    }
  }
  return null;
}

function stringProp(obj: ObjectLiteralExpression, name: string): string | null {
  const prop = obj.getProperty(name);
  if (prop && Node.isPropertyAssignment(prop)) {
    const init = prop.getInitializer();
    if (init && Node.isStringLiteral(init)) return init.getLiteralValue();
  }
  return null;
}

function resolveTsFile(configDir: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(configDir, spec);
  const candidates = [...EXTS.map((e) => base + e), ...EXTS.map((e) => join(base, "index" + e))];
  if (SOURCE_RE.test(base)) candidates.unshift(base);
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function joinRoute(parent: string, child: string | null): string {
  if (child == null || child === "") return parent || "/";
  if (child.startsWith("/")) return normalize(child);
  const base = parent === "/" ? "" : parent;
  return normalize(base + "/" + child);
}

function normalize(route: string): string {
  const r = ("/" + route).replace(/\/{2,}/g, "/");
  return r.length > 1 ? r.replace(/\/+$/, "") : "/";
}

function titleFromRoute(route: string): string {
  if (route === "/" || route === "") return "Home";
  const last = route.split("/").filter(Boolean).pop() ?? route;
  return last
    .replace(/^:(.+)$/, "$1")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function walkTs(dir: string, onFile: (file: string) => void): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, onFile);
    else if (entry.name.endsWith(".ts")) onFile(full);
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
