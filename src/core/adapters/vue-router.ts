import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { Project, Node, SyntaxKind, ts } from "ts-morph";
import type { SourceFile, ObjectLiteralExpression } from "ts-morph";
import type { FrameworkAdapter, ScreenFile } from "./types.js";
import { parseVueSfc, safeReadVue, titleFromRoute, resolveVueFile } from "./vue-sfc.js";

/**
 * Vue Router adapter (plain Vue 3 SPA + vue-router). Routes are *declared* in a TS/JS config
 * (`createRouter({ routes: [...] })` or an exported `routes` array), not file-based. discover()
 * parses that config with ts-morph, maps each route to the `.vue` component it renders (static
 * import or `() => import('…')`), resolves it to a file; parse() runs the shared SFC parser.
 *
 * Screen id = full route path ("/users/:id"); nested children join through parent paths.
 * Entry = "/". Excludes Nuxt (its own file-based adapter runs first).
 */
const SOURCE_RE = /\.(ts|js|mts|cts)$/;
const CONFIG_HINT = /createRouter|routes\s*:|VueRouter/;

function srcRootOf(projectRoot: string): string {
  const src = join(projectRoot, "src");
  return existsSync(src) && statSync(src).isDirectory() ? src : projectRoot;
}

function hasVueRouterDep(projectRoot: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return "vue-router" in deps && !("nuxt" in deps);
  } catch {
    return false;
  }
}

interface RouteEntry {
  route: string;
  spec: string | null; // module specifier of the component's .vue file
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

export const vueRouterAdapter: FrameworkAdapter = {
  id: "vue",
  router: "vue-router",

  detect(projectRoot) {
    return hasVueRouterDep(projectRoot);
  },

  discover(projectRoot) {
    const root = srcRootOf(projectRoot);
    const aliasRoot = root;
    const byRoute = new Map<string, ScreenFile>();

    walkSource(root, (file) => {
      const src = safeRead(file);
      if (!CONFIG_HINT.test(src)) return; // cheap pre-filter

      const sf = sourceFileFor(file);
      const entries = routesFromConfig(sf);
      if (entries.length === 0) return;

      const imports = importSpecs(sf);
      const configDir = dirname(file);
      for (const { route, spec } of entries) {
        if (byRoute.has(route)) continue; // first declaration wins
        const moduleSpec = spec ?? null;
        const abs = moduleSpec ? resolveVueFile(configDir, moduleSpec, aliasRoot) : null;
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
    return parseVueSfc(safeReadVue(file.absPath));
  },
};

// ---------- route extraction (ts-morph) ----------

/** Walk every `routes:` array and `createRouter({ routes })` in the file → flattened routes. */
function routesFromConfig(sf: SourceFile): RouteEntry[] {
  const out: RouteEntry[] = [];
  const imports = importSpecs(sf);
  // Any array assigned to a `routes` property, or the routes arg of createRouter.
  for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    if (pa.getName() !== "routes") continue;
    const init = pa.getInitializer();
    if (init && Node.isArrayLiteralExpression(init)) walkRouteArray(init, "/", out, imports);
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

/** `component: Home` (import) or `component: () => import('./X.vue')` → the .vue module specifier. */
function componentSpec(obj: ObjectLiteralExpression, imports: Map<string, string>): string | null {
  const comp = obj.getProperty("component");
  if (comp && Node.isPropertyAssignment(comp)) {
    const init = comp.getInitializer();
    if (!init) return null;
    if (Node.isIdentifier(init)) return imports.get(init.getText()) ?? null; // static import
    const dyn = dynamicImportSpecifier(init); // () => import('…')
    if (dyn) return dyn;
  }
  return null;
}

// ---------- helpers ----------

/** import name → module specifier (default + named static imports). */
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

function walkSource(dir: string, onFile: (file: string) => void): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkSource(full, onFile);
    else if (SOURCE_RE.test(entry.name)) onFile(full);
  }
}

function safeRead(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
