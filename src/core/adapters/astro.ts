import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * Astro adapter (file-based). `src/pages/**​/*.{astro,md,mdx,html}` → routes, mirroring Astro's
 * filesystem router. An `.astro` file is a `---` frontmatter (JS/TS) fence followed by HTML
 * markup — it can't reuse the JSX or Vue parsers, so this is a zero-dependency regex scan
 * (SwiftUI/Vue-SFC style): markup gives nav/features, frontmatter gives fetch calls.
 *
 *  - screen id = route ("/blog/[slug]"); `index` collapses to its dir; dynamic `[slug]`/`[...rest]` kept.
 *  - nav = <a href="/x"> (markup)
 *  - call = fetch("…") (frontmatter or markup script); src/pages/**.{js,ts} API routes are not screens
 *  - feature = <button>, <input|textarea|select>, <form>
 */
const PAGE_RE = /\.(astro|md|mdx|html)$/i;

function pagesDirOf(projectRoot: string): string | null {
  return (
    [join(projectRoot, "src", "pages"), join(projectRoot, "pages")].find(
      (d) => existsSync(d) && statSync(d).isDirectory(),
    ) ?? null
  );
}

export function hasAstroDep(projectRoot: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return "astro" in deps;
  } catch {
    return false;
  }
}

export const astroAdapter: FrameworkAdapter = {
  id: "astro",
  router: "astro-pages",

  detect(projectRoot) {
    return hasAstroDep(projectRoot) && pagesDirOf(projectRoot) !== null;
  },

  discover(projectRoot) {
    const pagesDir = pagesDirOf(projectRoot);
    if (!pagesDir) return [];
    const files: ScreenFile[] = [];
    walk(pagesDir, (file) => {
      if (!PAGE_RE.test(file)) return; // .js/.ts under pages/ are API endpoints, not screens
      const route = routeFromPageFile(pagesDir, file);
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
    return parseAstro(safeRead(file.absPath));
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

/** Astro page file → route. `index` collapses to its dir; keeps dynamic `[slug]`/`[...rest]`. */
function routeFromPageFile(pagesDir: string, file: string): string {
  const segs = relative(pagesDir, file).replace(PAGE_RE, "").split(sep);
  if (segs[segs.length - 1] === "index") segs.pop();
  const route = "/" + segs.join("/");
  return route.length > 1 ? route.replace(/\/+$/, "") : "/";
}

function titleFromRoute(route: string): string {
  if (route === "/") return "Home";
  const last = route.split("/").filter(Boolean).pop() ?? route;
  return last
    .replace(/^\[(\.\.\.)?(.+?)\]$/, "$2") // [slug] / [...rest] → slug / rest
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

// ---------- parsing (regex scan) ----------

const FEATURE_RULES: Array<{ re: RegExp; kind: RawFeature["kind"]; label: (m: RegExpMatchArray) => string }> = [
  { re: /<button\b[^>]*>([^<]*)/i, kind: "button", label: (m) => m[1].trim() || "Button" },
  { re: /<(?:input|textarea|select)\b[^>]*\bplaceholder=["']([^"']*)["']/i, kind: "input", label: (m) => m[1] || "Input" },
  { re: /<(?:input|textarea|select)\b/i, kind: "input", label: () => "Input" },
  { re: /<form\b/i, kind: "form", label: () => "Form" },
];

const HREF = /<a\b[^>]*?\shref=["'](\/[^"'#]*)["']/i;
const FETCH = /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]/;

function parseAstro(src: string): RawScreen {
  const navs: RawNav[] = [];
  const calls: RawCall[] = [];
  const features: RawFeature[] = [];

  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNo = i + 1;

    const href = line.match(HREF);
    if (href) navs.push({ target: href[1], raw: snippet(line), trigger: "<a href>", line: lineNo });

    const fetchM = line.match(FETCH);
    if (fetchM) calls.push({ url: fetchM[1], raw: snippet(line), trigger: "fetch", line: lineNo });

    for (const rule of FEATURE_RULES) {
      const m = line.match(rule.re);
      if (m) {
        features.push({ kind: rule.kind, label: rule.label(m), detail: m[0].trim().slice(0, 40), line: lineNo });
        break;
      }
    }
  }

  return { navs, calls, features, components: [], contains: [] };
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? flat.slice(0, 77) + "..." : flat;
}
