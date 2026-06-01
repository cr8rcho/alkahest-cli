import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * iOS UIKit adapter (Swift, programmatic). Screen = `class X: UIViewController` (and the common
 * subclasses). Pairs with `swiftui` as the iOS set; registered after it, so a SwiftUI project
 * (which may import UIKit) is claimed by swiftui first and only pure-UIKit apps fall here.
 *
 * Parsing is a zero-dependency line scan (swiftui's style). Storyboard segues need the .storyboard
 * XML, which we don't parse yet — programmatic navigation is covered.
 *
 * Mapping:
 *  - transition: pushViewController(X()) / present(X()) / instantiateViewController(...) → target VC
 *  - call: URL(string:) / "https://…" / URLRequest(url:)
 *  - feature: UIButton / UITextField / UITableView / UICollectionView / UISwitch …
 */
const VC_CLASS = /\bclass\s+([A-Za-z_]\w*)\s*:\s*[^{]*\b(UI(?:View|TableView|CollectionView|Navigation|TabBar|Page|Split)Controller)\b/;
const SKIP_DIRS = /^(deprecated|archive|archieve|build|\.build|Pods)$/i;

export const uikitAdapter: FrameworkAdapter = {
  id: "uikit",
  router: "uikit-vc",

  detect(projectRoot) {
    let found = false;
    walkSwift(projectRoot, (file) => {
      if (found) return;
      const src = safeRead(file);
      if (/\bimport\s+UIKit\b/.test(src.slice(0, 4000)) && VC_CLASS.test(src)) found = true;
    });
    return found;
  },

  discover(projectRoot) {
    const files: ScreenFile[] = [];
    walkSwift(projectRoot, (file) => {
      const src = safeRead(file);
      const primary = primaryVC(file, src);
      if (!primary) return;
      files.push({
        absPath: file,
        relPath: relative(projectRoot, file).split(sep).join("/"),
        id: primary,
        route: primary,
        title: primary.replace(/(ViewController|VC|Controller)$/, "") || primary,
      });
    });
    files.sort((a, b) => a.id.localeCompare(b.id));
    return files;
  },

  parse(file) {
    return parseUiKit(safeRead(file.absPath));
  },
};

// ---------- discovery ----------

function walkSwift(dir: string, onFile: (file: string) => void): void {
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

/** A file's primary view controller: prefer the VC matching the filename, else the first VC class. */
function primaryVC(file: string, src: string): string | null {
  const names: string[] = [];
  for (const line of src.split("\n")) {
    const m = line.match(VC_CLASS);
    if (m) names.push(m[1]);
  }
  if (!names.length) return null;
  const stem = file.slice(file.lastIndexOf(sep) + 1).replace(/\.swift$/, "");
  return names.includes(stem) ? stem : names[0];
}

// ---------- parsing (line heuristics) ----------

const NAV_CONSTRUCTS: Array<{ re: RegExp; trigger: string }> = [
  { re: /\bpushViewController\b/, trigger: "pushViewController" },
  { re: /\bpresent\s*\(/, trigger: "present" },
  { re: /\bshow\s*\(/, trigger: "show" },
  { re: /\binstantiateViewController\b/, trigger: "instantiateViewController" },
];

const FEATURE_RULES: Array<{ re: RegExp; kind: RawFeature["kind"]; label: (m: RegExpMatchArray) => string }> = [
  { re: /\bUIButton\b/, kind: "button", label: () => "Button" },
  { re: /\b(?:UITextField|UITextView|UISearchBar)\b/, kind: "input", label: () => "Input" },
  { re: /\b(?:UISwitch|UISlider|UIStepper|UISegmentedControl|UIPickerView|UIDatePicker)\b/, kind: "input", label: () => "Input" },
  { re: /\b(?:UITableView|UICollectionView)\b/, kind: "list", label: () => "List" },
];

const VC_INSTANCE = /\b([A-Z]\w*(?:ViewController|VC))\s*\(/;
const VC_BINDING = /\b(?:let|var)\s+(\w+)\s*=\s*([A-Z]\w*(?:ViewController|VC))\s*\(/;
const URL_STRING = /URL\(string:\s*"([^"]+)"|"(https?:\/\/[^"]+)"/;
const URL_REQUEST = /URLRequest\(\s*url:/;

function parseUiKit(src: string): RawScreen {
  const lines = src.split("\n");
  const navs: RawNav[] = [];
  const calls: RawCall[] = [];
  const features: RawFeature[] = [];
  const components = new Set<string>();
  // var name → VC type, e.g. `let vc = DetailsViewController()` so `pushViewController(vc)` resolves.
  const bindings = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // --- local binding: track `let/var x = XxxViewController()` for later nav-arg resolution ---
    const bind = line.match(VC_BINDING);
    if (bind) bindings.set(bind[1], bind[2]);

    // --- transition: nav construct → target VC (inline instance, or a bound variable) ---
    const nav = NAV_CONSTRUCTS.find((c) => c.re.test(line));
    if (nav) {
      const target = findNavTarget(lines, i, bindings);
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

    // --- feature: UIKit controls (one per line) ---
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

/**
 * Target VC for a nav construct. Prefer an inline `XxxViewController(` on the same/next 3 lines;
 * otherwise resolve the call's first argument identifier against the tracked `let x = VC()` bindings
 * (the common `let vc = DetailsViewController(); push(vc)` pattern).
 */
function findNavTarget(lines: string[], i: number, bindings: Map<string, string>): string | null {
  for (let j = i; j < Math.min(i + 4, lines.length); j++) {
    const inst = lines[j].match(VC_INSTANCE);
    if (inst) return inst[1];
  }
  // No inline instance — look at the argument passed to the nav call on this line.
  const arg = lines[i].match(/(?:pushViewController|present|show)\s*\(\s*([A-Za-z_]\w*)/);
  if (arg && bindings.has(arg[1])) return bindings.get(arg[1])!;
  return null;
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? flat.slice(0, 77) + "..." : flat;
}
