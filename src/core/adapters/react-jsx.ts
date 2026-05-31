import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Project, Node, SyntaxKind, ts } from "ts-morph";
import type { SourceFile, JsxOpeningElement, JsxSelfClosingElement } from "ts-morph";
import type { RawScreen } from "./types.js";

/**
 * Shared React/JSX parsing for all React-family adapters (next-app, next-pages,
 * react-router, …). Only file→screen discovery differs per framework; the JSX
 * signal extraction (Link/NavLink/<a>, router.push, navigate(), fetch, query
 * hooks, form/button/input, .map lists) is identical, so it lives here.
 */

let _project: Project | null = null;
/** Shared ts-morph project (lazy). allowJs + React JSX so .jsx/.tsx all parse. */
export function project(): Project {
  if (!_project)
    _project = new Project({
      useInMemoryFileSystem: false,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: { allowJs: true, jsx: ts.JsxEmit.React },
    });
  return _project;
}

/** Add a file to the shared project, reusing it if already added (parse is idempotent). */
export function sourceFileFor(absPath: string): SourceFile {
  return project().getSourceFile(absPath) ?? project().addSourceFileAtPath(absPath);
}

/** True if any of `names` is a (dev)dependency in the project's package.json. */
export function hasDependency(projectRoot: string, ...names: string[]): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return names.some((n) => n in deps);
  } catch {
    return false;
  }
}

/**
 * A non-Next React SPA that happens to use a `pages/`-style folder shouldn't be read as
 * Next.js. True when react-router is a dependency and Next.js is not — the Next adapters
 * bow out in that case (the dependency signal beats the directory-name heuristic).
 */
export function isReactRouterSpa(projectRoot: string): boolean {
  return hasDependency(projectRoot, "react-router-dom", "react-router") && !hasDependency(projectRoot, "next");
}

/** Recursively visit every file under `dir`, skipping node_modules and dotfiles. */
export function walk(dir: string, onFile: (file: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

/** Last path segment → Title Case, unwrapping dynamic `[slug]`/`:slug`. Shared route→title. */
export function titleFromRoute(route: string): string {
  if (route === "/" || route === "") return "Home";
  const last = route.split("/").filter(Boolean).pop() ?? route;
  return last
    .replace(/^\[(\.\.\.)?(.+?)\]$/, "$2") // [slug] / [...all] → slug / all
    .replace(/^:(.+)$/, "$1") // :slug → slug (react-router dynamic)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- JSX parsing ----------

const NAV_HOOKS = new Set(["redirect", "permanentRedirect"]);
const QUERY_HOOKS = new Set(["useQuery", "useMutation", "useSWR", "useSWRMutation", "useInfiniteQuery"]);
const HTML_INPUTS = new Set(["input", "textarea", "select"]);
// Capitalized JSX tags that are framework nav primitives, not user components.
const NAV_COMPONENTS = new Set(["Link", "NavLink", "Navigate"]);

/** Parse one React/JSX screen file into raw nav/call/feature signals. */
export function parseReactScreen(sf: SourceFile): RawScreen {
  const navs: RawScreen["navs"] = [];
  const calls: RawScreen["calls"] = [];
  const features: RawScreen["features"] = [];
  const components = new Set<string>();

  const navImports = importedFrom(sf, "next/navigation");
  const routerVars = collectHookVars(sf, "useRouter"); // next: router.push/replace
  const navigateVars = collectHookVars(sf, "useNavigate"); // react-router: navigate()

  const elements = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const el of elements) {
    const tag = el.getTagNameNode().getText();
    const line = el.getStartLineNumber();
    if (tag === "Link" || tag === "NavLink" || tag === "a") {
      // Next uses href; react-router uses to. Accept either.
      const href = attrString(el, "href");
      const to = attrString(el, "to");
      const attrName = href !== undefined ? "href" : "to";
      navs.push({
        target: href ?? to ?? null,
        raw: snippet(el.getText()),
        trigger: tag === "a" ? "<a href>" : `<${tag} ${attrName}>`,
        line,
      });
    } else if (tag === "Navigate") {
      navs.push({ target: attrString(el, "to") ?? null, raw: snippet(el.getText()), trigger: "<Navigate to>", line });
    } else if (tag === "form") {
      features.push({ kind: "form", label: "Form", detail: "form", line });
    } else if (tag === "button" || tag === "Button") {
      const text = Node.isJsxOpeningElement(el) ? jsxText(el) : "";
      features.push({ kind: "button", label: text || "Button", detail: tag, line });
    } else if (HTML_INPUTS.has(tag)) {
      const label = attrString(el, "placeholder") ?? attrString(el, "name") ?? tag;
      features.push({ kind: "input", label, detail: tag, line });
    }
    if (/^[A-Z]/.test(tag) && !NAV_COMPONENTS.has(tag)) components.add(tag);
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
      if (navigateVars.has(fn)) {
        navs.push({ target: literalString(args[0]), raw: snippet(ce.getText()), trigger: "navigate()", line });
      } else if (fn === "fetch") {
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
/** Vars bound to a `const x = useXxx()` call — e.g. useRouter → router, useNavigate → navigate. */
function collectHookVars(sf: SourceFile, hook: string): Set<string> {
  const vars = new Set<string>();
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (init && Node.isCallExpression(init) && init.getExpression().getText() === hook) {
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
