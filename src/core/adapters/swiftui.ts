import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";
import type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * SwiftUI 어댑터 (첫 비-JS 어댑터, ALKAHEST.md §8).
 * 화면 = `struct X: View`. 파싱은 의존성 0 휴리스틱(라인 스캔).
 * 나중에 tree-sitter-swift 로 교체 가능(인터페이스 동일).
 *
 * 매핑:
 *  - 이동: NavigationLink(destination:) / .sheet / .fullScreenCover / .navigationDestination → 대상 View
 *  - 포함: TabView Tab{}/embed 가 인스턴스화하는 자식 View → contains (resolve 에서 엣지화)
 *  - 호출: URL(string:) / "https://…" / URLRequest(url:) → 엔드포인트
 *  - 기능: Button / TextField / Toggle / Picker / List / ForEach / Form …
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
      if (!entryView) entryView = entryViewIn(src); // @main App 이 띄우는 루트 View
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
      if (SKIP_DIRS.test(entry.name)) continue; // 죽은 코드 폴더 제외
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

/** 파일의 대표 View: 파일명과 같은 View 우선, 없으면 첫 View struct. 없으면 null. */
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
 * `@main struct X: App` 의 body 에서 처음 인스턴스화하는 View → 앱 진입점.
 * 예: iobookApp.body → `ContentView()` → "ContentView".
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
  { re: /\bButton\s*\(\s*"([^"]*)"/, kind: "button", label: (m) => m[1] || "버튼" },
  { re: /\bButton\s*\{/, kind: "button", label: () => "버튼" },
  { re: /\b(?:TextField|SecureField)\s*\(\s*"([^"]*)"/, kind: "input", label: (m) => m[1] || "입력" },
  { re: /\b(?:Toggle|Picker|Stepper|Slider|DatePicker)\s*\(\s*"([^"]*)"/, kind: "input", label: (m) => m[1] || "입력" },
  { re: /\bForm\s*\{/, kind: "form", label: () => "폼" },
  { re: /\b(?:List|ForEach)\b/, kind: "list", label: () => "리스트" },
];

const VIEW_INSTANCE = /\b([A-Z]\w*View)\s*\(/g;
const DEST_VIEW = /destination:\s*([A-Z]\w*)\s*\(/;
const URL_STRING = /URL\(string:\s*"([^"]+)"|"(https?:\/\/[^"]+)"/;
const URL_REQUEST = /URLRequest\(\s*url:/;
const CTOR_CALL = /\b([A-Z]\w*)\s*\(/g;

/** SwiftUI 내장 컨테이너/요소 — contains 후보에서 제외(노이즈). */
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

    // --- 이동: 네비 구문이 있는 라인 (+ 다음 몇 줄)에서 대상 View 추출 ---
    const nav = NAV_CONSTRUCTS.find((c) => c.re.test(line));
    if (nav) {
      const target = findNavTarget(lines, i);
      navs.push({ target, raw: snippet(line), trigger: nav.trigger, line: lineNo });
      if (target) components.add(target);
    }

    // --- 호출: URL 리터럴 / URLRequest ---
    const urlM = line.match(URL_STRING);
    if (urlM) {
      calls.push({ url: urlM[1] ?? urlM[2] ?? null, raw: snippet(line), trigger: "URL", line: lineNo });
    } else if (URL_REQUEST.test(line)) {
      calls.push({ url: null, raw: snippet(line), trigger: "URLRequest", line: lineNo });
    }

    // --- 기능: UI 컨트롤 (라인당 하나) ---
    for (const rule of FEATURE_RULES) {
      const m = line.match(rule.re);
      if (m) {
        features.push({ kind: rule.kind, label: rule.label(m), detail: m[0].trim().slice(0, 40), line: lineNo });
        break;
      }
    }

    // --- 컴포넌트(표시용: XxxView) ---
    if (!nav) {
      for (const m of line.matchAll(VIEW_INSTANCE)) components.add(m[1]);
    }

    // --- contains 후보: 대문자 생성자 호출 (내장 제외). resolve 가 screenIds 와 교집합. ---
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

/** 네비 구문에서 대상 View 이름: destination: 우선, 없으면 같은/다음 3줄에서 XxxView(. */
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
