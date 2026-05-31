import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * Jetpack Compose adapter (Android, Kotlin). Like react-navigation, screens are *registered*
 * against string routes in a NavHost, not file-based — but Kotlin can't reuse the ts-morph
 * parser, so this is a zero-dependency line/regex scan in the SwiftUI adapter's style.
 *
 * Model:
 *  - screen = a `composable("route") { Foo(...) }` destination in a NavHost. id = the route string.
 *  - the destination's first @Composable call (Foo()) tells us which composable renders it; we
 *    parse THAT function's body (across files) for nav/calls/features.
 *  - transition = navController.navigate("route") → target route (resolves against screen ids).
 *  - call = Retrofit/Ktor/`client.get("url")` / `URL("…")` string literals.
 *  - feature = Button / TextField / OutlinedTextField / Checkbox / Switch / LazyColumn / etc.
 *
 * Entry = the NavHost `startDestination = "route"`.
 */

const COMPOSABLE_DEST = /\bcomposable\s*\(\s*(?:route\s*=\s*)?"([^"]+)"/;
const START_DEST = /\bstartDestination\s*=\s*"([^"]+)"/;
const NAVIGATE = /\bnavigate\s*\(\s*"([^"]+)"/;
// @Composable usually sits on its own line above `fun Name(` — match across whitespace/newlines, globally.
const COMPOSABLE_FN_G = /@Composable\s+(?:private\s+|internal\s+|public\s+)?fun\s+([A-Za-z_]\w*)\s*\(/g;
const SKIP_DIRS = /^(build|\.gradle|\.idea)$/i;

export const composeAdapter: FrameworkAdapter = {
  id: "compose",
  router: "compose-nav",

  detect(projectRoot) {
    let found = false;
    walkKotlin(projectRoot, (file) => {
      if (found) return;
      const src = safeRead(file).slice(0, 4000);
      if (/\bandroidx\.compose\b/.test(src) || /\bandroidx\.navigation\.compose\b/.test(src)) found = true;
    });
    return found;
  },

  discover(projectRoot) {
    // Pass 1: index every @Composable fn name → its source file (for route→composable resolution).
    const fnFile = new Map<string, string>();
    const sources = new Map<string, string>();
    walkKotlin(projectRoot, (file) => {
      const src = safeRead(file);
      sources.set(file, src);
      // @Composable and `fun` are usually on separate lines — scan the whole source, not line-by-line.
      for (const m of src.matchAll(COMPOSABLE_FN_G)) {
        if (!fnFile.has(m[1])) fnFile.set(m[1], file);
      }
    });

    // Pass 2: find NavHost composable("route") { Composable() } destinations.
    const files: ScreenFile[] = [];
    const seen = new Set<string>();
    let startDest: string | null = null;
    for (const [file, src] of sources) {
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!startDest) {
          const sd = lines[i].match(START_DEST);
          if (sd) startDest = sd[1];
        }
        const dest = lines[i].match(COMPOSABLE_DEST);
        if (!dest) continue;
        const route = dest[1];
        if (seen.has(route)) continue;
        seen.add(route);
        // The composable rendered by this destination → its defining file (fall back to the NavHost file).
        const target = firstComposableCall(lines, i);
        const declFile = (target && fnFile.get(target)) || file;
        files.push({
          absPath: declFile,
          relPath: relative(projectRoot, declFile).split(sep).join("/"),
          id: route,
          route,
          title: titleFromRoute(route, target),
        });
      }
    }

    if (startDest) {
      const e = files.find((f) => f.id === startDest);
      if (e) e.isEntry = true;
    }
    files.sort((a, b) => a.id.localeCompare(b.id));
    return files;
  },

  parse(file) {
    return parseKotlin(safeRead(file.absPath));
  },
};

// ---------- discovery helpers ----------

function walkKotlin(dir: string, onFile: (file: string) => void): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.test(entry.name)) continue;
      walkKotlin(full, onFile);
    } else if (entry.name.endsWith(".kt")) {
      onFile(full);
    }
  }
}

function safeRead(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** The first PascalCase composable call inside a `composable(...) { ... }` block (same or next few lines). */
function firstComposableCall(lines: string[], i: number): string | null {
  for (let j = i; j < Math.min(i + 4, lines.length); j++) {
    // skip the composable( … ) registration call itself; look for an invoked Composable, e.g. HomeScreen(
    const after = j === i ? lines[j].replace(COMPOSABLE_DEST, "") : lines[j];
    const m = after.match(/\b([A-Z]\w*)\s*\(/);
    if (m) return m[1];
  }
  return null;
}

/** Route string → Title; falls back to the composable name. `home` → Home, `detail/{id}` → Detail. */
function titleFromRoute(route: string, composable: string | null): string {
  const seg = route.split("/").filter((s) => s && !s.startsWith("{"))[0];
  const base = seg || composable || route;
  return base
    .replace(/Screen$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- parsing (line heuristics) ----------

const FEATURE_RULES: Array<{ re: RegExp; kind: RawFeature["kind"]; label: (m: RegExpMatchArray) => string }> = [
  { re: /\b(?:Button|OutlinedButton|TextButton|IconButton|FloatingActionButton|ElevatedButton|FilledTonalButton)\s*\(/, kind: "button", label: () => "Button" },
  { re: /\b(?:TextField|OutlinedTextField|BasicTextField)\s*\(/, kind: "input", label: () => "Input" },
  { re: /\b(?:Checkbox|Switch|RadioButton|Slider)\s*\(/, kind: "input", label: () => "Input" },
  { re: /\b(?:LazyColumn|LazyRow|LazyVerticalGrid|LazyHorizontalGrid)\s*\(/, kind: "list", label: () => "List" },
];

const URL_STRING = /\b(?:URL|HttpUrl)\s*\(\s*"([^"]+)"|"(https?:\/\/[^"]+)"/;
const HTTP_CLIENT = /\bclient\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\s*\(\s*"([^"]+)"|\b(?:Retrofit|OkHttpClient|HttpClient)\s*\(/;

function parseKotlin(src: string): RawScreen {
  const lines = src.split("\n");
  const navs: RawNav[] = [];
  const calls: RawCall[] = [];
  const features: RawFeature[] = [];
  const components = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // --- transition: navController.navigate("route") ---
    const nav = line.match(NAVIGATE);
    if (nav) navs.push({ target: nav[1], raw: snippet(line), trigger: "navigate()", line: lineNo });

    // --- call: URL literal / typed HTTP client ---
    const urlM = line.match(URL_STRING);
    if (urlM) {
      calls.push({ url: urlM[1] ?? urlM[2] ?? null, raw: snippet(line), trigger: "URL", line: lineNo });
    } else {
      const httpM = line.match(HTTP_CLIENT);
      if (httpM) calls.push({ url: httpM[2] ?? null, method: httpM[1]?.toUpperCase(), raw: snippet(line), trigger: "http", line: lineNo });
    }

    // --- feature: Compose UI controls (one per line) ---
    for (const rule of FEATURE_RULES) {
      const m = line.match(rule.re);
      if (m) {
        features.push({ kind: rule.kind, label: rule.label(m), detail: m[0].trim().slice(0, 40), line: lineNo });
        break;
      }
    }

    // --- components: invoked PascalCase composables that look like screens (XxxScreen) ---
    for (const m of line.matchAll(/\b([A-Z]\w*Screen)\s*\(/g)) components.add(m[1]);
  }

  return { navs, calls, features, components: [...components].sort(), contains: [] };
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? flat.slice(0, 77) + "..." : flat;
}
