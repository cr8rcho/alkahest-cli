import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";
import type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * Flutter adapter (Dart). Pairs with swiftui/uikit/compose as the native set. Dart can't reuse
 * any JS parser, so this is a zero-dependency line/regex scan (swiftui's style).
 *
 * Screen = a page-level Widget: `class X extends StatelessWidget|StatefulWidget`. id = class name.
 * Navigation has three flavours, all resolved to a target screen:
 *  - imperative:  Navigator.push(context, MaterialPageRoute(builder: (_) => DetailsScreen())) → DetailsScreen
 *  - named:       Navigator.pushNamed(context, '/details')  → via the `routes:` table (route → widget)
 *  - go_router:   context.go('/details') / context.push('/details') / GoRoute(path:'/details', builder: … Widget)
 * call = http/dio calls + Uri.parse('url'); feature = ElevatedButton/TextField/ListView/etc.
 *
 * The route→widget map (named routes + GoRoute) is built across all files during discover, so
 * parse() can turn a string route into the widget-class screen id.
 */
const WIDGET_CLASS = /\bclass\s+([A-Za-z_]\w*)\s+extends\s+(StatelessWidget|StatefulWidget)\b/;
const APP_SHELL = /\breturn\s+(?:const\s+)?(?:MaterialApp|CupertinoApp|WidgetsApp)\b/;
const SKIP_DIRS = /^(build|\.dart_tool|\.idea|ios|android|web|macos|linux|windows)$/i;

// route string → widget class name, populated during discover (named routes + GoRoute paths).
let routeToWidget = new Map<string, string>();

function libDirOf(projectRoot: string): string | null {
  const lib = join(projectRoot, "lib");
  return existsSync(lib) ? lib : existsSync(join(projectRoot, "pubspec.yaml")) ? projectRoot : null;
}

export const flutterAdapter: FrameworkAdapter = {
  id: "flutter",
  router: "flutter-nav",

  detect(projectRoot) {
    const pubspec = join(projectRoot, "pubspec.yaml");
    if (existsSync(pubspec)) {
      const src = safeRead(pubspec);
      if (/^\s*flutter\s*:/m.test(src) || /\bsdk:\s*flutter\b/.test(src)) return true;
    }
    // Fallback: a .dart file with a Widget class.
    let found = false;
    walkDart(projectRoot, (file) => {
      if (found) return;
      if (WIDGET_CLASS.test(safeRead(file))) found = true;
    });
    return found;
  },

  discover(projectRoot) {
    const root = libDirOf(projectRoot) ?? projectRoot;
    const files: ScreenFile[] = [];
    routeToWidget = new Map<string, string>();

    walkDart(root, (file) => {
      const src = safeRead(file);
      // route→widget map (named-route table + go_router GoRoute) for resolving string targets later.
      collectRoutes(src, routeToWidget);
      const primary = primaryWidget(file, src);
      if (!primary) return;
      files.push({
        absPath: file,
        relPath: relative(projectRoot, file).split(sep).join("/"),
        id: primary,
        route: primary,
        title: primary.replace(/(Page|Screen|View|Widget)$/, "") || primary,
      });
    });

    // Entry: the screen the app shell opens first — the '/' named route, else MaterialApp(home: X()).
    const entryId = routeToWidget.get("/") ?? homeWidget(root);
    if (entryId) {
      const e = files.find((f) => f.id === entryId);
      if (e) e.isEntry = true;
    }
    files.sort((a, b) => a.id.localeCompare(b.id));
    return files;
  },

  parse(file) {
    return parseDart(safeRead(file.absPath));
  },
};

// ---------- discovery ----------

function walkDart(dir: string, onFile: (file: string) => void): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.test(entry.name)) continue;
      walkDart(full, onFile);
    } else if (entry.name.endsWith(".dart")) {
      onFile(full);
    }
  }
}

/**
 * A file's primary page widget: prefer the one matching the filename, else the first widget class.
 * An app-shell widget (build returns MaterialApp/CupertinoApp/WidgetsApp) is not a screen; skip a
 * file that is only that shell.
 */
function primaryWidget(file: string, src: string): string | null {
  const names: string[] = [];
  for (const line of src.split("\n")) {
    const m = line.match(WIDGET_CLASS);
    if (m) names.push(m[1]);
  }
  if (!names.length) return null;
  if (APP_SHELL.test(src) && names.length === 1) return null; // pure app shell, e.g. MyApp → MaterialApp
  const stem = pascal(basename(file, ".dart"));
  return names.find((n) => n.toLowerCase() === stem.toLowerCase()) ?? names[0];
}

/** `MaterialApp(home: SomeWidget())` → the first-shown screen (used when there's no '/' named route). */
function homeWidget(root: string): string | null {
  let home: string | null = null;
  walkDart(root, (file) => {
    if (home) return;
    const m = safeRead(file).match(/\bhome:\s*(?:const\s+)?([A-Z]\w*)\s*\(/);
    if (m) home = m[1];
  });
  return home;
}

/** route string → widget class, from a `routes: { '/x': (c) => XPage() }` table and `GoRoute(path:'/x', builder: … YPage())`. */
function collectRoutes(src: string, map: Map<string, string>): void {
  // named-route table entries: '/path': (ctx) => SomeWidget(
  for (const m of src.matchAll(/["']([^"']+)["']\s*:\s*\([^)]*\)\s*=>\s*(?:const\s+)?([A-Z]\w*)\s*\(/g)) {
    if (!map.has(m[1])) map.set(m[1], m[2]);
  }
  // go_router: GoRoute(path: '/x', builder: (c, s) => SomeWidget(
  for (const m of src.matchAll(/GoRoute\s*\(\s*path:\s*["']([^"']+)["'][\s\S]{0,120}?=>\s*(?:const\s+)?([A-Z]\w*)\s*\(/g)) {
    if (!map.has(m[1])) map.set(m[1], m[2]);
  }
}

// ---------- parsing (line heuristics) ----------

const FEATURE_RULES: Array<{ re: RegExp; kind: RawFeature["kind"]; label: (m: RegExpMatchArray) => string }> = [
  { re: /\b(?:ElevatedButton|TextButton|OutlinedButton|IconButton|FloatingActionButton|FilledButton|CupertinoButton)\b/, kind: "button", label: () => "Button" },
  { re: /\b(?:TextField|TextFormField|CupertinoTextField)\b/, kind: "input", label: () => "Input" },
  { re: /\b(?:Switch|Checkbox|Radio|Slider|DropdownButton)\b/, kind: "input", label: () => "Input" },
  { re: /\b(?:ListView|GridView)\b/, kind: "list", label: () => "List" },
];

const WIDGET_INSTANCE = /\b([A-Z]\w*(?:Page|Screen|View))\s*\(/;
const PUSH_NAMED = /\b(?:pushNamed|pushReplacementNamed|popAndPushNamed)\s*\(\s*[^,]+,\s*["']([^"']+)["']/;
const GO_ROUTER = /\bcontext\.(?:go|push|replace)\s*\(\s*["']([^"']+)["']/;
const HTTP_CALL = /\b(?:http|dio)\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\s*\(\s*(?:Uri\.parse\(\s*)?["']([^"']+)["']/;
const URI_PARSE = /\bUri\.parse\s*\(\s*["']([^"']+)["']/;

function parseDart(src: string): RawScreen {
  const lines = src.split("\n");
  const navs: RawNav[] = [];
  const calls: RawCall[] = [];
  const features: RawFeature[] = [];
  const components = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // --- transition (imperative): Navigator.push(... => SomeScreen()) ---
    if (/\bNavigator\.(push|pushReplacement)\b/.test(line)) {
      const target = findPushTarget(lines, i);
      navs.push({ target, raw: snippet(line), trigger: "Navigator.push", line: lineNo });
      if (target) components.add(target);
    }
    // --- transition (named): pushNamed(context, '/route') → widget via the route table ---
    const named = line.match(PUSH_NAMED);
    if (named) {
      const target = routeToWidget.get(named[1]) ?? null;
      navs.push({ target, raw: snippet(line), trigger: "pushNamed", line: lineNo });
    }
    // --- transition (go_router): context.go('/route') → widget via the route table ---
    const go = line.match(GO_ROUTER);
    if (go) {
      const target = routeToWidget.get(go[1]) ?? null;
      navs.push({ target, raw: snippet(line), trigger: "context.go", line: lineNo });
    }

    // --- call: http/dio + Uri.parse ---
    const httpM = line.match(HTTP_CALL);
    if (httpM) {
      calls.push({ url: httpM[2], method: httpM[1].toUpperCase(), raw: snippet(line), trigger: "http", line: lineNo });
    } else {
      const uriM = line.match(URI_PARSE);
      if (uriM) calls.push({ url: uriM[1], raw: snippet(line), trigger: "Uri", line: lineNo });
    }

    // --- feature: Flutter controls (one per line) ---
    for (const rule of FEATURE_RULES) {
      const m = line.match(rule.re);
      if (m) {
        features.push({ kind: rule.kind, label: rule.label(m), detail: m[0].trim().slice(0, 40), line: lineNo });
        break;
      }
    }
  }

  return { navs, calls, features, components: [...components].sort(), contains: [] };
}

/** Target page widget for a Navigator.push: an XxxPage|Screen|View( on the same/next 3 lines. */
function findPushTarget(lines: string[], i: number): string | null {
  for (let j = i; j < Math.min(i + 4, lines.length); j++) {
    const inst = lines[j].match(WIDGET_INSTANCE);
    if (inst) return inst[1];
  }
  return null;
}

// ---------- helpers ----------

function pascal(name: string): string {
  return name.replace(/(?:^|_)([a-z])/g, (_, c: string) => c.toUpperCase());
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
