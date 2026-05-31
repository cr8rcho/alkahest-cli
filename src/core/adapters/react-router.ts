import { readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep, dirname, resolve } from "node:path";
import { Node, SyntaxKind } from "ts-morph";
import type { SourceFile, ObjectLiteralExpression, JsxElement, JsxSelfClosingElement } from "ts-morph";
import type { FrameworkAdapter, ScreenFile } from "./types.js";
import { walk, sourceFileFor, parseReactScreen, titleFromRoute, hasDependency } from "./react-jsx.js";

/**
 * React Router adapter (generic React SPA: Vite / CRA). Routes are *declared*, not
 * file-based — so discover parses the router config (data router objects and/or JSX
 * <Routes>/<Route>), maps each route to the component it renders, and resolves that
 * component to its source file. parse() then runs the shared JSX parser on that file.
 *
 * Screen id = full route path ("/dashboard/settings"). Entry = "/".
 * Supported route forms:
 *  - createBrowserRouter / createHashRouter / createMemoryRouter ([{ path, element, children }])
 *  - JSX <Routes><Route path element /></Routes> (incl. nested + index routes)
 *  - element={<X/>} or Component={X}; lazy(() => import("…")) component imports
 */

const ROUTER_CALLS = new Set(["createBrowserRouter", "createHashRouter", "createMemoryRouter"]);
const SOURCE_RE = /\.(tsx|jsx|ts|js)$/;
const CONFIG_HINT = /create(Browser|Hash|Memory)Router|createRoutesFromElements|<Routes[\s>]|<Route[\s/>]/;
const EXTS = [".tsx", ".ts", ".jsx", ".js"];

function srcRootOf(projectRoot: string): string {
  const src = join(projectRoot, "src");
  return existsSync(src) && statSync(src).isDirectory() ? src : projectRoot;
}

interface RouteEntry {
  route: string;
  component: string | null;
}

export const reactRouterAdapter: FrameworkAdapter = {
  id: "react-router",
  router: "react-router",

  detect(projectRoot) {
    return hasDependency(projectRoot, "react-router-dom", "react-router");
  },

  discover(projectRoot) {
    const root = srcRootOf(projectRoot);
    const byRoute = new Map<string, ScreenFile>();

    walk(root, (file) => {
      if (!SOURCE_RE.test(file)) return;
      const src = safeRead(file);
      if (!CONFIG_HINT.test(src)) return; // cheap pre-filter before parsing

      const sf = sourceFileFor(file);
      const entries = [...routesFromDataRouter(sf), ...routesFromJsx(sf)];
      if (entries.length === 0) return;

      const imports = importMap(sf);
      const configDir = dirname(file);
      for (const { route, component } of entries) {
        if (byRoute.has(route)) continue; // first declaration wins
        const abs = component ? resolveComponentFile(configDir, imports.get(component)) : null;
        if (!abs) continue; // can't open the component → can't extract signals; skip
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
    return parseReactScreen(sourceFileFor(file.absPath));
  },
};

// ---------- route extraction ----------

/** createBrowserRouter([...]) and friends → flattened routes (paths joined through children). */
function routesFromDataRouter(sf: SourceFile): RouteEntry[] {
  const out: RouteEntry[] = [];
  for (const ce of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = ce.getExpression();
    if (!Node.isIdentifier(expr) || !ROUTER_CALLS.has(expr.getText())) continue;
    const arg = ce.getArguments()[0];
    if (arg && Node.isArrayLiteralExpression(arg)) walkRouteArray(arg, "/", out);
  }
  return out;
}

function walkRouteArray(arr: Node, parentPath: string, out: RouteEntry[]): void {
  if (!Node.isArrayLiteralExpression(arr)) return;
  for (const el of arr.getElements()) {
    if (Node.isObjectLiteralExpression(el)) walkRouteObject(el, parentPath, out);
  }
}

function walkRouteObject(obj: ObjectLiteralExpression, parentPath: string, out: RouteEntry[]): void {
  const isIndex = boolProp(obj, "index");
  const pathVal = stringProp(obj, "path");
  const route = isIndex ? parentPath : joinRoute(parentPath, pathVal);
  const component = componentOfObject(obj);
  if (component || pathVal != null || isIndex) out.push({ route, component });

  const childrenProp = obj.getProperty("children");
  if (childrenProp && Node.isPropertyAssignment(childrenProp)) {
    const init = childrenProp.getInitializer();
    if (init) walkRouteArray(init, route, out);
  }
}

/** <Routes><Route .../></Routes> and createRoutesFromElements(...) → flattened routes. */
function routesFromJsx(sf: SourceFile): RouteEntry[] {
  const out: RouteEntry[] = [];
  const routes = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ].filter((el) => tagName(el) === "Route");

  for (const el of routes) {
    if (nearestRouteAncestor(el)) continue; // children handled via recursion from their parent
    walkRouteJsx(el, "/", out);
  }
  return out;
}

function walkRouteJsx(el: JsxElement | JsxSelfClosingElement, parentPath: string, out: RouteEntry[]): void {
  const isIndex = jsxBoolAttr(el, "index");
  const pathVal = jsxStringAttr(el, "path");
  const route = isIndex ? parentPath : joinRoute(parentPath, pathVal);
  const component = componentOfJsx(el);
  if (component || pathVal != null || isIndex) out.push({ route, component });

  if (Node.isJsxElement(el)) {
    for (const child of el.getJsxChildren()) {
      if ((Node.isJsxElement(child) || Node.isJsxSelfClosingElement(child)) && tagName(child) === "Route") {
        walkRouteJsx(child, route, out);
      }
    }
  }
}

// ---------- component → file resolution ----------

/** import name → module specifier (static default/named imports + `lazy(() => import("…"))`). */
function importMap(sf: SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    const def = imp.getDefaultImport();
    if (def) map.set(def.getText(), spec);
    for (const n of imp.getNamedImports()) map.set(n.getName(), spec);
  }
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (init && Node.isCallExpression(init) && init.getExpression().getText() === "lazy") {
      const spec = dynamicImportSpecifier(init.getArguments()[0]);
      if (spec) map.set(decl.getName(), spec);
    }
  }
  return map;
}

function resolveComponentFile(configDir: string, spec: string | undefined): string | null {
  if (!spec || !spec.startsWith(".")) return null; // only resolve local files
  const base = resolve(configDir, spec);
  const candidates = [
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => join(base, "index" + e)),
  ];
  if (SOURCE_RE.test(base)) candidates.unshift(base);
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

// ---------- small ts-morph helpers ----------

function tagName(el: JsxElement | JsxSelfClosingElement): string {
  return Node.isJsxElement(el) ? el.getOpeningElement().getTagNameNode().getText() : el.getTagNameNode().getText();
}

function nearestRouteAncestor(el: Node): boolean {
  for (let p = el.getParent(); p; p = p.getParent()) {
    if ((Node.isJsxElement(p) || Node.isJsxSelfClosingElement(p)) && tagName(p) === "Route") return true;
  }
  return false;
}

/** element={<X/>} / Component={X} → "X". */
function componentOfJsx(el: JsxElement | JsxSelfClosingElement): string | null {
  const attrs = Node.isJsxElement(el) ? el.getOpeningElement() : el;
  const element = attrs.getAttribute("element");
  if (element && Node.isJsxAttribute(element)) {
    const init = element.getInitializer();
    if (init && Node.isJsxExpression(init)) {
      const inner = init.getExpression();
      if (inner && (Node.isJsxElement(inner) || Node.isJsxSelfClosingElement(inner))) return tagName(inner);
    }
  }
  const comp = attrs.getAttribute("Component");
  if (comp && Node.isJsxAttribute(comp)) {
    const init = comp.getInitializer();
    if (init && Node.isJsxExpression(init)) {
      const inner = init.getExpression();
      if (inner && Node.isIdentifier(inner)) return inner.getText();
    }
  }
  return null;
}

/** { element: <X/> } / { Component: X } → "X". */
function componentOfObject(obj: ObjectLiteralExpression): string | null {
  const element = obj.getProperty("element");
  if (element && Node.isPropertyAssignment(element)) {
    const init = element.getInitializer();
    if (init && (Node.isJsxElement(init) || Node.isJsxSelfClosingElement(init))) return tagName(init);
  }
  const comp = obj.getProperty("Component");
  if (comp && Node.isPropertyAssignment(comp)) {
    const init = comp.getInitializer();
    if (init && Node.isIdentifier(init)) return init.getText();
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

function boolProp(obj: ObjectLiteralExpression, name: string): boolean {
  const prop = obj.getProperty(name);
  if (prop && Node.isPropertyAssignment(prop)) {
    return prop.getInitializer()?.getText() === "true";
  }
  return false;
}

function jsxStringAttr(el: JsxElement | JsxSelfClosingElement, name: string): string | null {
  const attrs = Node.isJsxElement(el) ? el.getOpeningElement() : el;
  const attr = attrs.getAttribute(name);
  if (!attr || !Node.isJsxAttribute(attr)) return null;
  const init = attr.getInitializer();
  if (!init) return null;
  if (Node.isStringLiteral(init)) return init.getLiteralValue();
  if (Node.isJsxExpression(init)) {
    const inner = init.getExpression();
    if (inner && Node.isStringLiteral(inner)) return inner.getLiteralValue();
  }
  return null;
}

/** Bare boolean attr (`index`) or `index={true}`. */
function jsxBoolAttr(el: JsxElement | JsxSelfClosingElement, name: string): boolean {
  const attrs = Node.isJsxElement(el) ? el.getOpeningElement() : el;
  const attr = attrs.getAttribute(name);
  if (!attr || !Node.isJsxAttribute(attr)) return false;
  const init = attr.getInitializer();
  if (!init) return true; // bare `index`
  if (Node.isJsxExpression(init)) return init.getExpression()?.getText() === "true";
  return false;
}

function dynamicImportSpecifier(arrowOrCall: Node | undefined): string | null {
  if (!arrowOrCall) return null;
  for (const ce of arrowOrCall.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (ce.getExpression().getKind() === SyntaxKind.ImportKeyword) {
      const a = ce.getArguments()[0];
      if (a && Node.isStringLiteral(a)) return a.getLiteralValue();
    }
  }
  return null;
}

/** Join a child route segment onto a parent path (react-router relative semantics). */
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

function safeRead(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
