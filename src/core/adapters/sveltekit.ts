import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * SvelteKit adapter (file-based). `src/routes/**​/+page.svelte` → routes, mirroring
 * SvelteKit's filesystem router. Screen id = route ("/blog/[slug]"); route groups `(x)`
 * are stripped, `[id]`/`[...rest]` kept. Entry = "/".
 *
 * A `.svelte` file can't reuse the JSX or Vue parsers — it's `<script>` + Svelte markup —
 * so parsing is a zero-dependency line/regex scan in the SwiftUI/Vue-SFC style.
 *
 * Mapping:
 *  - nav (markup): <a href="/x"> ; (script): goto("/x") from $app/navigation
 *  - call (script): fetch("…") ; load() data fns live in +page(.server).ts (not parsed yet)
 *  - feature (markup): <button>, <input|textarea|select>, <form>, {#each} (list)
 */
const PAGE_FILE = "+page.svelte";

function routesDirOf(projectRoot: string): string | null {
  return (
    [join(projectRoot, "src", "routes"), join(projectRoot, "routes")].find(
      (d) => existsSync(d) && statSync(d).isDirectory(),
    ) ?? null
  );
}

function hasSvelteKitDep(projectRoot: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return "@sveltejs/kit" in deps;
  } catch {
    return false;
  }
}

export const svelteKitAdapter: FrameworkAdapter = {
  id: "svelte",
  router: "sveltekit",

  detect(projectRoot) {
    return hasSvelteKitDep(projectRoot) && routesDirOf(projectRoot) !== null;
  },

  discover(projectRoot) {
    const routesDir = routesDirOf(projectRoot);
    if (!routesDir) return [];
    const files: ScreenFile[] = [];
    walk(routesDir, (file) => {
      if (!file.endsWith(sep + PAGE_FILE)) return;
      const route = routeFromPageFile(routesDir, file);
      files.push({
        absPath: file,
        relPath: relative(projectRoot, file).split(sep).join("/"),
        id: route,
        route,
        title: titleFromRoute(route),
        isEntry: route === "/",
      });
    });
    files.sort((a, b) => a.route.localeCompare(b.route));
    return files;
  },

  parse(file) {
    return parseSvelte(safeRead(file.absPath));
  },
};

// ---------- discovery ----------

function walk(dir: string, onFile: (file: string) => void): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

/** SvelteKit route dir → route. Drops the `+page.svelte` leaf, strips `(group)` segments. */
function routeFromPageFile(routesDir: string, file: string): string {
  const segs = relative(routesDir, file)
    .split(sep)
    .slice(0, -1) // drop the +page.svelte filename
    .filter((s) => !(s.startsWith("(") && s.endsWith(")"))); // route groups are not URL segments
  const route = "/" + segs.join("/");
  return route.length > 1 ? route.replace(/\/+$/, "") : "/";
}

function titleFromRoute(route: string): string {
  if (route === "/") return "Home";
  const last = route.split("/").filter(Boolean).pop() ?? route;
  return last
    .replace(/^\[(\.\.\.)?(.+?)\]$/, "$2") // [id] / [...rest] → id / rest
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function safeRead(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

// ---------- parsing (line/regex scan) ----------

const FEATURE_RULES: Array<{ re: RegExp; kind: RawFeature["kind"]; label: (m: RegExpMatchArray) => string }> = [
  { re: /<button\b[^>]*>([^<]*)/i, kind: "button", label: (m) => m[1].trim() || "Button" },
  { re: /<(?:input|textarea|select)\b[^>]*\bplaceholder=["']([^"']*)["']/i, kind: "input", label: (m) => m[1] || "Input" },
  { re: /<(?:input|textarea|select)\b/i, kind: "input", label: () => "Input" },
  { re: /<form\b/i, kind: "form", label: () => "Form" },
  { re: /\{#each\b/i, kind: "list", label: () => "List" },
];

const GOTO = /\bgoto\s*\(\s*["'`]([^"'`]+)["'`]/;
const HREF = /<a\b[^>]*?\shref=["'](\/[^"']*)["']/i;
const FETCH = /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]/;

function parseSvelte(src: string): RawScreen {
  const navs: RawNav[] = [];
  const calls: RawCall[] = [];
  const features: RawFeature[] = [];
  const components = new Set<string>();

  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNo = i + 1;

    const href = line.match(HREF);
    if (href) navs.push({ target: href[1], raw: snippet(line), trigger: "<a href>", line: lineNo });

    const goto = line.match(GOTO);
    if (goto) navs.push({ target: goto[1], raw: snippet(line), trigger: "goto()", line: lineNo });

    const fetchM = line.match(FETCH);
    if (fetchM) calls.push({ url: fetchM[1], raw: snippet(line), trigger: "fetch", line: lineNo });

    for (const rule of FEATURE_RULES) {
      const m = line.match(rule.re);
      if (m) {
        features.push({ kind: rule.kind, label: rule.label(m), detail: m[0].trim().slice(0, 40), line: lineNo });
        break;
      }
    }

    for (const cm of line.matchAll(/<([A-Z]\w*)\b/g)) components.add(cm[1]);
  }

  return { navs, calls, features, components: [...components].sort(), contains: [] };
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? flat.slice(0, 77) + "..." : flat;
}
