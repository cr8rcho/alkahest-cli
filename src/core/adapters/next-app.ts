import { readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Project, Node, SyntaxKind, ts } from "ts-morph";
import type { SourceFile, JsxOpeningElement, JsxSelfClosingElement } from "ts-morph";
import type { FrameworkAdapter, ScreenFile, RawScreen } from "./types.js";

/**
 * Next.js app-router adapter: treats `app/**​/page.tsx` as screens, parses with ts-morph.
 * Screen id = route ("/dashboard/settings"). Entry point = root route "/".
 */
const PAGE_RE = /^page\.(tsx|jsx|ts|js)$/;

function appDirOf(projectRoot: string): string | null {
  return (
    [join(projectRoot, "app"), join(projectRoot, "src", "app")].find(
      (d) => existsSync(d) && statSync(d).isDirectory(),
    ) ?? null
  );
}

export const nextAppAdapter: FrameworkAdapter = {
  id: "next",
  router: "next-app",

  detect(projectRoot) {
    return appDirOf(projectRoot) !== null;
  },

  discover(projectRoot) {
    const appDir = appDirOf(projectRoot);
    if (!appDir) return [];
    const files: ScreenFile[] = [];
    walk(appDir, (file) => {
      const base = file.slice(file.lastIndexOf(sep) + 1);
      if (!PAGE_RE.test(base)) return;
      const route = routeFromAppFile(appDir, file);
      files.push({
        absPath: file,
        relPath: relative(projectRoot, file).split(sep).join("/"),
        id: route,
        route,
        title: titleFromRoute(route),
        isEntry: route === "/", // app-router entry point = root route
      });
    });
    files.sort((a, b) => a.route.localeCompare(b.route));
    return files;
  },

  parse(file) {
    return parseScreen(project().addSourceFileAtPath(file.absPath));
  },
};

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

function walk(dir: string, onFile: (file: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

/** app-router file path → route. Strips route groups `(x)`, keeps dynamic `[slug]`. */
function routeFromAppFile(appDir: string, file: string): string {
  const segs = relative(appDir, file)
    .split(sep)
    .slice(0, -1)
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  const route = "/" + segs.join("/");
  return route.length > 1 ? route.replace(/\/+$/, "") : "/";
}

function titleFromRoute(route: string): string {
  if (route === "/") return "Home";
  const last = route.split("/").filter(Boolean).pop() ?? route;
  return last
    .replace(/^\[(\.\.\.)?(.+?)\]$/, "$2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- ts-morph parsing ----------

const NAV_HOOKS = new Set(["redirect", "permanentRedirect"]);
const QUERY_HOOKS = new Set(["useQuery", "useMutation", "useSWR", "useSWRMutation", "useInfiniteQuery"]);
const HTML_INPUTS = new Set(["input", "textarea", "select"]);

function parseScreen(sf: SourceFile): RawScreen {
  const navs: RawScreen["navs"] = [];
  const calls: RawScreen["calls"] = [];
  const features: RawScreen["features"] = [];
  const components = new Set<string>();

  const navImports = importedFrom(sf, "next/navigation");
  const routerVars = collectRouterVars(sf);

  const elements = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const el of elements) {
    const tag = el.getTagNameNode().getText();
    const line = el.getStartLineNumber();
    if (tag === "Link" || tag === "a") {
      navs.push({
        target: attrString(el, "href") ?? null,
        raw: snippet(el.getText()),
        trigger: tag === "Link" ? "<Link href>" : "<a href>",
        line,
      });
    } else if (tag === "form") {
      features.push({ kind: "form", label: "Form", detail: "form", line });
    } else if (tag === "button" || tag === "Button") {
      const text = Node.isJsxOpeningElement(el) ? jsxText(el) : "";
      features.push({ kind: "button", label: text || "Button", detail: tag, line });
    } else if (HTML_INPUTS.has(tag)) {
      const label = attrString(el, "placeholder") ?? attrString(el, "name") ?? tag;
      features.push({ kind: "input", label, detail: tag, line });
    }
    if (/^[A-Z]/.test(tag) && tag !== "Link") components.add(tag);
  }

  for (const ce of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = ce.getExpression();
    const line = ce.getStartLineNumber();
    const args = ce.getArguments();
    if (Node.isPropertyAccessExpression(expr)) {
      const obj = expr.getExpression().getText();
      const name = expr.getName();
      if (routerVars.has(obj) && (name === "push" || name === "replace")) {
        navs.push({ target: literalString(args[0]), raw: snippet(ce.getText()), trigger: `router.${name}`, line });
      } else if (name === "map" && callbackReturnsJsx(args)) {
        features.push({ kind: "list", label: "List", detail: `${obj}.map`, line });
      }
      continue;
    }
    if (Node.isIdentifier(expr)) {
      const fn = expr.getText();
      if (fn === "fetch") {
        calls.push({ url: literalString(args[0]), method: fetchMethod(args[1]), raw: snippet(ce.getText()), trigger: "fetch", line });
      } else if (NAV_HOOKS.has(fn) && navImports.has(fn)) {
        navs.push({ target: literalString(args[0]), raw: snippet(ce.getText()), trigger: `${fn}()`, line });
      } else if (QUERY_HOOKS.has(fn)) {
        calls.push({ url: null, raw: snippet(ce.getText()), trigger: fn, line });
      }
    }
  }

  return { navs, calls, features, components: [...components].sort(), contains: [] };
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? flat.slice(0, 77) + "..." : flat;
}
function importedFrom(sf: SourceFile, moduleSpecifier: string): Set<string> {
  const names = new Set<string>();
  for (const imp of sf.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== moduleSpecifier) continue;
    for (const n of imp.getNamedImports()) names.add(n.getName());
  }
  return names;
}
function collectRouterVars(sf: SourceFile): Set<string> {
  const vars = new Set<string>();
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (init && Node.isCallExpression(init) && init.getExpression().getText() === "useRouter") {
      vars.add(decl.getName());
    }
  }
  return vars;
}
function literalString(arg: Node | undefined): string | null {
  if (arg && Node.isStringLiteral(arg)) return arg.getLiteralValue();
  return null;
}
function attrString(el: JsxOpeningElement | JsxSelfClosingElement, name: string): string | undefined {
  const attr = el.getAttribute(name);
  if (!attr || !Node.isJsxAttribute(attr)) return undefined;
  const init = attr.getInitializer();
  if (!init) return undefined;
  if (Node.isStringLiteral(init)) return init.getLiteralValue();
  if (Node.isJsxExpression(init)) {
    const inner = init.getExpression();
    if (inner && Node.isStringLiteral(inner)) return inner.getLiteralValue();
  }
  return undefined;
}
function jsxText(opening: JsxOpeningElement): string {
  const parent = opening.getParent();
  if (!parent || !Node.isJsxElement(parent)) return "";
  return parent
    .getJsxChildren()
    .filter((c) => c.getKind() === SyntaxKind.JsxText)
    .map((c) => c.getText().trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}
function fetchMethod(arg: Node | undefined): string | undefined {
  if (!arg || !Node.isObjectLiteralExpression(arg)) return undefined;
  const prop = arg.getProperty("method");
  if (prop && Node.isPropertyAssignment(prop)) {
    const init = prop.getInitializer();
    if (init && Node.isStringLiteral(init)) return init.getLiteralValue();
  }
  return undefined;
}
function callbackReturnsJsx(args: Node[]): boolean {
  const cb = args[0];
  if (!cb || (!Node.isArrowFunction(cb) && !Node.isFunctionExpression(cb))) return false;
  return (
    cb.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
    cb.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0
  );
}
