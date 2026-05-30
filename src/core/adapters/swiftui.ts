import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";
import type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * SwiftUI adapter (first non-JS adapter, ALKAHEST.md §8).
 * Screen = `struct X: View`. Parsing uses zero-dependency heuristics (line scan).
 * Can later be swapped for tree-sitter-swift (same interface).
 *
 * Mapping:
 *  - transition: NavigationLink(destination:) / .sheet / .fullScreenCover / .navigationDestination → target View
 *  - containment: child Views instantiated by TabView Tab{}/embed → contains (turned into edges in resolve)
 *  - call: URL(string:) / "https://…" / URLRequest(url:) → endpoint
 *  - feature: Button / TextField / Toggle / Picker / List / ForEach / Form …
 */

const VIEW_STRUCT = /\bstruct\s+([A-Za-z_]\w*)\s*:\s*[^{]*\bView\b/;
const SKIP_DIRS = /^(deprecated|archive|archieve)$/i;

export const swiftUiAdapter: FrameworkAdapter = {
  id: "swiftui",
  router: "swiftui-views",

  detect(projectRoot) {
    let found = false;
    walkSwift(projectRoot, (file) => {
      if (found) return;
      const src = safeRead(file);
      if (/\bimport\s+SwiftUI\b/.test(src.slice(0, 2000)) && VIEW_STRUCT.test(src)) found = true;
    });
    return found;
  },

  discover(projectRoot) {
    const files: ScreenFile[] = [];
    let entryView: string | null = null;
    walkSwift(projectRoot, (file) => {
      const src = safeRead(file);
      if (!entryView) entryView = entryViewIn(src); // root View launched by the @main App
      const primary = primaryView(file, src);
      if (!primary) return;
      files.push({
        absPath: file,
        relPath: relative(projectRoot, file).split(sep).join("/"),
        id: primary,
        route: primary,
        title: primary.replace(/View$/, "") || primary,
      });
    });
    if (entryView) {
      const e = files.find((f) => f.id === entryView);
      if (e) e.isEntry = true;
    }
    files.sort((a, b) => a.id.localeCompare(b.id));
    return files;
  },

  parse(file) {
    return parseSwift(safeRead(file.absPath));
  },
};

// ---------- discovery helpers ----------

function walkSwift(dir: string, onFile: (file: string) => void): void {
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
      if (SKIP_DIRS.test(entry.name)) continue; // skip dead-code folders
      walkSwift(full, onFile);
    } else if (entry.name.endsWith(".swift")) {
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

/** A file's primary View: prefer the View matching the filename, else the first View struct. Null if none. */
function primaryView(file: string, src: string): string | null {
  const names: string[] = [];
  for (const line of src.split("\n")) {
    const m = line.match(VIEW_STRUCT);
    if (m) names.push(m[1]);
  }
  if (!names.length) return null;
  const stem = basename(file, ".swift");
  return names.includes(stem) ? stem : names[0];
}

/**
 * The first View instantiated in the body of `@main struct X: App` → app entry point.
 * Example: iobookApp.body → `ContentView()` → "ContentView".
 */
function entryViewIn(src: string): string | null {
  if (!/@main/.test(src) || !/:\s*App\b/.test(src)) return null;
  const bodyIdx = src.search(/var\s+body\s*:\s*some\s+Scene/);
  const region = bodyIdx >= 0 ? src.slice(bodyIdx) : src;
  const m = region.match(/\b([A-Z]\w*)\s*\(\s*\)/);
  return m ? m[1] : null;
}

// ---------- parsing (line heuristics) ----------

const NAV_CONSTRUCTS: Array<{ re: RegExp; trigger: string }> = [
  { re: /NavigationLink/, trigger: "NavigationLink" },
  { re: /\.navigationDestination/, trigger: ".navigationDestination" },
  { re: /\.sheet\b/, trigger: ".sheet" },
  { re: /\.fullScreenCover\b/, trigger: ".fullScreenCover" },
  { re: /\.popover\b/, trigger: ".popover" },
];

const FEATURE_RULES: Array<{ re: RegExp; kind: RawFeature["kind"]; label: (m: RegExpMatchArray) => string }> = [
  { re: /\bButton\s*\(\s*"([^"]*)"/, kind: "button", label: (m) => m[1] || "Button" },
  { re: /\bButton\s*\{/, kind: "button", label: () => "Button" },
  { re: /\b(?:TextField|SecureField)\s*\(\s*"([^"]*)"/, kind: "input", label: (m) => m[1] || "Input" },
  { re: /\b(?:Toggle|Picker|Stepper|Slider|DatePicker)\s*\(\s*"([^"]*)"/, kind: "input", label: (m) => m[1] || "Input" },
  { re: /\bForm\s*\{/, kind: "form", label: () => "Form" },
  { re: /\b(?:List|ForEach)\b/, kind: "list", label: () => "List" },
];

const VIEW_INSTANCE = /\b([A-Z]\w*View)\s*\(/g;
const DEST_VIEW = /destination:\s*([A-Z]\w*)\s*\(/;
const URL_STRING = /URL\(string:\s*"([^"]+)"|"(https?:\/\/[^"]+)"/;
const URL_REQUEST = /URLRequest\(\s*url:/;
const CTOR_CALL = /\b([A-Z]\w*)\s*\(/g;

/** SwiftUI built-in containers/elements — excluded from contains candidates (noise). */
const SWIFT_BUILTINS = new Set([
  "VStack", "HStack", "ZStack", "LazyVStack", "LazyHStack", "LazyVGrid", "LazyHGrid", "Grid", "GridRow",
  "Text", "Image", "Button", "Label", "Link", "Spacer", "Divider", "Group", "Section", "Form", "List",
  "ForEach", "Toggle", "Picker", "Stepper", "Slider", "DatePicker", "TextField", "SecureField", "TextEditor",
  "NavigationStack", "NavigationView", "NavigationLink", "TabView", "Tab", "ScrollView", "ScrollViewReader",
  "Color", "Circle", "Rectangle", "RoundedRectangle", "Capsule", "Ellipse", "Path", "Menu", "Chart",
  "GeometryReader", "Canvas", "Gauge", "ProgressView", "Table", "DisclosureGroup", "ControlGroup", "LazyView",
  "AnyView", "EmptyView", "ViewThatFits",
]);

function parseSwift(src: string): RawScreen {
  const lines = src.split("\n");
  const navs: RawNav[] = [];
  const calls: RawCall[] = [];
  const features: RawFeature[] = [];
  const components = new Set<string>();
  const contains = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // --- transition: extract target View from the line with a nav construct (+ next few lines) ---
    const nav = NAV_CONSTRUCTS.find((c) => c.re.test(line));
    if (nav) {
      const target = findNavTarget(lines, i);
      navs.push({ target, raw: snippet(line), trigger: nav.trigger, line: lineNo });
      if (target) components.add(target);
    }

    // --- call: URL literal / URLRequest ---
    const urlM = line.match(URL_STRING);
    if (urlM) {
      calls.push({ url: urlM[1] ?? urlM[2] ?? null, raw: snippet(line), trigger: "URL", line: lineNo });
    } else if (URL_REQUEST.test(line)) {
      calls.push({ url: null, raw: snippet(line), trigger: "URLRequest", line: lineNo });
    }

    // --- feature: UI controls (one per line) ---
    for (const rule of FEATURE_RULES) {
      const m = line.match(rule.re);
      if (m) {
        features.push({ kind: rule.kind, label: rule.label(m), detail: m[0].trim().slice(0, 40), line: lineNo });
        break;
      }
    }

    // --- components (for display: XxxView) ---
    if (!nav) {
      for (const m of line.matchAll(VIEW_INSTANCE)) components.add(m[1]);
    }

    // --- contains candidates: capitalized constructor calls (excluding built-ins). resolve intersects with screenIds. ---
    for (const m of line.matchAll(CTOR_CALL)) {
      if (!SWIFT_BUILTINS.has(m[1])) contains.add(m[1]);
    }
  }

  return {
    navs,
    calls,
    features,
    components: [...components].sort(),
    contains: [...contains].sort(),
  };
}

/** Target View name from a nav construct: prefer destination:, else XxxView( on the same/next 3 lines. */
function findNavTarget(lines: string[], i: number): string | null {
  for (let j = i; j < Math.min(i + 4, lines.length); j++) {
    const dest = lines[j].match(DEST_VIEW);
    if (dest) return dest[1];
    const inst = lines[j].match(/\b([A-Z]\w*View)\s*\(/);
    if (inst && inst.index !== undefined && !/NavigationLink|navigationDestination|sheet|fullScreenCover|popover/.test(lines[j].slice(0, inst.index)))
      return inst[1];
  }
  return null;
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? flat.slice(0, 77) + "..." : flat;
}
