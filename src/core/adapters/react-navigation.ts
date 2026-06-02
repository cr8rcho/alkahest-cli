import { readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { Node } from "ts-morph";
import type { SourceFile, JsxOpeningElement, JsxSelfClosingElement } from "ts-morph";
import type { FrameworkAdapter, ScreenFile } from "./types.js";
import { sourceFileFor, walk, parseReactScreen, titleFromRoute, hasDependency, importMap, resolveComponentFile } from "./react-jsx.js";

/**
 * React Navigation adapter (React Native, config-based). Screens are *registered*, not
 * file-based: `<Stack.Screen name="Home" component={HomeScreen} />` (also Tab/Drawer/any
 * `*.Screen`). discover() reads each registration, maps name→component, resolves the
 * component to its source file; parse() then runs the shared react-jsx parser.
 *
 * Screen id = the route `name` (what `navigation.navigate("Home")` targets, so transitions
 * resolve). Entry = the nearest `<*.Navigator initialRouteName>`, else the first registered.
 *
 * Containment: a screen whose component renders a navigator (e.g. a Tab/Drawer navigator)
 * "contains" that navigator's child `*.Screen`s — surfaced as contains edges (parent → tabs),
 * mirroring the SwiftUI TabView behaviour.
 */
const SOURCE_RE = /\.(tsx|jsx|ts|js)$/;
const CONFIG_HINT = /\.Screen[\s/>]|\.Navigator[\s>]|create\w*Navigator/;

interface Registration {
  name: string;
  component: string | null;
}

export const reactNavigationAdapter: FrameworkAdapter = {
  id: "react-native",
  router: "react-navigation",

  // Expo Router is registered first; this is the non-Expo React Navigation path.
  detect(projectRoot) {
    return hasDependency(projectRoot, "@react-navigation/native");
  },

  discover(projectRoot) {
    const root = srcRootOf(projectRoot);
    const byName = new Map<string, ScreenFile>();
    let entryName: string | null = null;

    walk(root, (file) => {
      if (!SOURCE_RE.test(file)) return;
      const src = safeRead(file);
      if (!CONFIG_HINT.test(src)) return; // cheap pre-filter before parsing

      const sf = sourceFileFor(file);
      const { registrations, initialRouteName } = collectRegistrations(sf);
      if (registrations.length === 0) return;
      if (initialRouteName && !entryName) entryName = initialRouteName;

      const imports = importMap(sf);
      const dir = dirname(file);
      for (const { name, component } of registrations) {
        if (byName.has(name)) continue; // first registration wins
        const abs = component ? resolveComponentFile(dir, imports.get(component)) : null;
        if (!abs) continue; // can't open the component → can't extract signals; skip
        byName.set(name, {
          absPath: abs,
          relPath: relative(projectRoot, abs).split(sep).join("/"),
          id: name,
          route: name,
          title: titleFromRoute(name),
          isEntry: false,
        });
      }
    });

    const files = [...byName.values()];
    // Entry: initialRouteName if it resolved to a real screen, else the first registered.
    const entry = (entryName && byName.get(entryName)) || files[0];
    if (entry) entry.isEntry = true;
    return files.sort((a, b) => a.route.localeCompare(b.route));
  },

  parse(file) {
    const sf = sourceFileFor(file.absPath);
    const signals = parseReactScreen(sf);
    // If this screen's component renders a navigator (Tab/Drawer/Stack), its child
    // `<*.Screen name>` entries are structurally contained by this screen → contains edges
    // (e.g. a Tab navigator's tabs). resolve.ts keeps only those that are real screens and
    // aren't already navigate targets, so this is safe to over-supply.
    const children = collectRegistrations(sf).registrations
      .map((r) => r.name)
      .filter((name) => name !== file.id);
    return { ...signals, contains: [...new Set([...signals.contains, ...children])] };
  },
};

// ---------- registration extraction ----------

/**
 * Collect `<*.Screen name component>` registrations and any `<*.Navigator initialRouteName>`.
 * Single descendant pass; attributes are read immediately (ts-morph node wrappers can go
 * stale if the tree is re-queried — same caveat the react-router adapter documents).
 */
function collectRegistrations(sf: SourceFile): { registrations: Registration[]; initialRouteName: string | null } {
  const registrations: Registration[] = [];
  let initialRouteName: string | null = null;

  for (const node of sf.getDescendants()) {
    let el: JsxOpeningElement | JsxSelfClosingElement | null = null;
    if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) el = node;
    if (!el) continue;
    const tag = el.getTagNameNode().getText();
    if (tag.endsWith(".Screen")) {
      const name = jsxStringAttr(el, "name");
      if (name) registrations.push({ name, component: jsxIdentAttr(el, "component") });
    } else if (tag.endsWith(".Navigator")) {
      const ir = jsxStringAttr(el, "initialRouteName");
      if (ir && !initialRouteName) initialRouteName = ir;
    }
  }
  return { registrations, initialRouteName };
}

// ---------- helpers ----------

function srcRootOf(projectRoot: string): string {
  const src = join(projectRoot, "src");
  return existsSync(src) && statSync(src).isDirectory() ? src : projectRoot;
}

/** String-valued JSX attribute (`name="Home"` or `name={"Home"}`). */
function jsxStringAttr(el: JsxOpeningElement | JsxSelfClosingElement, name: string): string | null {
  const attr = el.getAttribute(name);
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

/** Identifier-valued JSX attribute (`component={HomeScreen}`) → "HomeScreen". */
function jsxIdentAttr(el: JsxOpeningElement | JsxSelfClosingElement, name: string): string | null {
  const attr = el.getAttribute(name);
  if (!attr || !Node.isJsxAttribute(attr)) return null;
  const init = attr.getInitializer();
  if (init && Node.isJsxExpression(init)) {
    const inner = init.getExpression();
    if (inner && Node.isIdentifier(inner)) return inner.getText();
  }
  return null;
}

function safeRead(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
