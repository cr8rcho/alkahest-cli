import { Project, Node, SyntaxKind, ts } from "ts-morph";
import type { SourceFile, JsxOpeningElement, JsxSelfClosingElement } from "ts-morph";
import type { Feature } from "./types.js";

/** 파싱 단계의 원시 신호 — resolve 단계가 이걸 그래프 모델로 변환한다(ALKAHEST.md §4). */
export interface RawNav {
  /** 정적으로 푼 대상 경로/URL, 못 풀면 null */
  target: string | null;
  raw: string;
  trigger: string;
  line: number;
}
export interface RawCall {
  /** 정적으로 푼 엔드포인트 URL, 못 풀면 null */
  url: string | null;
  method?: string;
  raw: string;
  trigger: string;
  line: number;
}
export interface RawFeature {
  kind: Feature["kind"];
  label: string;
  detail: string;
  line: number;
}
export interface RawScreen {
  navs: RawNav[];
  calls: RawCall[];
  features: RawFeature[];
  components: string[];
}

/** TSX/JSX 를 구문 파싱하기 위한 ts-morph 프로젝트. 타입 체크/의존성 해석은 하지 않는다. */
export function createProject(): Project {
  return new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: ts.JsxEmit.React },
  });
}

const NAV_HOOKS = new Set(["redirect", "permanentRedirect"]);
const QUERY_HOOKS = new Set(["useQuery", "useMutation", "useSWR", "useSWRMutation", "useInfiniteQuery"]);
const HTML_INPUTS = new Set(["input", "textarea", "select"]);

/**
 * 한 화면 소스를 파싱해 이동/호출/UI기능/컴포넌트 원시 신호를 추출한다.
 * Phase 1 한계: 페이지 파일 자체만 본다(임포트한 컴포넌트 내부는 미추적).
 */
export function parseScreen(sf: SourceFile): RawScreen {
  const navs: RawNav[] = [];
  const calls: RawCall[] = [];
  const features: RawFeature[] = [];
  const components = new Set<string>();

  // next/navigation 에서 가져온 이름만 redirect 류로 신뢰
  const navImports = importedFrom(sf, "next/navigation");
  // const X = useRouter() → 라우터 변수 추적
  const routerVars = collectRouterVars(sf);

  // --- JSX 요소: 이동(Link/a) · UI 기능(form/button/input) · 컴포넌트 ---
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
      features.push({ kind: "form", label: "폼", detail: "form", line });
    } else if (tag === "button" || tag === "Button") {
      const text = Node.isJsxOpeningElement(el) ? jsxText(el) : "";
      features.push({ kind: "button", label: text || "버튼", detail: tag, line });
    } else if (HTML_INPUTS.has(tag)) {
      const label = attrString(el, "placeholder") ?? attrString(el, "name") ?? tag;
      features.push({ kind: "input", label, detail: tag, line });
    }

    if (/^[A-Z]/.test(tag) && tag !== "Link") components.add(tag);
  }

  // --- 호출 표현식: router.push · redirect · fetch · query 훅 · .map 리스트 ---
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
        features.push({ kind: "list", label: "리스트", detail: `${obj}.map`, line });
      }
      continue;
    }

    if (Node.isIdentifier(expr)) {
      const fn = expr.getText();
      if (fn === "fetch") {
        calls.push({
          url: literalString(args[0]),
          method: fetchMethod(args[1]),
          raw: snippet(ce.getText()),
          trigger: "fetch",
          line,
        });
      } else if (NAV_HOOKS.has(fn) && navImports.has(fn)) {
        navs.push({ target: literalString(args[0]), raw: snippet(ce.getText()), trigger: `${fn}()`, line });
      } else if (QUERY_HOOKS.has(fn)) {
        // URL 은 보통 queryFn 안에 있어 정적으로 못 풀 때가 많음 → 미해결 호출로 기록
        calls.push({ url: null, raw: snippet(ce.getText()), trigger: fn, line });
      }
    }
  }

  return { navs, calls, features, components: [...components].sort() };
}

// ---------- helpers ----------

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? flat.slice(0, 77) + "..." : flat;
}

/** 모듈 specifier 에서 named import 한 이름 집합. */
function importedFrom(sf: SourceFile, moduleSpecifier: string): Set<string> {
  const names = new Set<string>();
  for (const imp of sf.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== moduleSpecifier) continue;
    for (const n of imp.getNamedImports()) names.add(n.getName());
  }
  return names;
}

/** `const x = useRouter()` 형태의 x 들. */
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

/** 문자열 리터럴 인자면 값을, 아니면 null. */
function literalString(arg: Node | undefined): string | null {
  if (arg && Node.isStringLiteral(arg)) return arg.getLiteralValue();
  return null;
}

/** JSX 속성이 문자열 리터럴이면 그 값(`href="/x"` 또는 `href={"/x"}`). */
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

/** 여는 요소의 텍스트 자식들(버튼 라벨 등)을 합친다. */
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

/** fetch 두 번째 인자 객체의 method 리터럴. */
function fetchMethod(arg: Node | undefined): string | undefined {
  if (!arg || !Node.isObjectLiteralExpression(arg)) return undefined;
  const prop = arg.getProperty("method");
  if (prop && Node.isPropertyAssignment(prop)) {
    const init = prop.getInitializer();
    if (init && Node.isStringLiteral(init)) return init.getLiteralValue();
  }
  return undefined;
}

/** .map 콜백이 JSX 를 반환하는지(리스트 렌더 휴리스틱). */
function callbackReturnsJsx(args: Node[]): boolean {
  const cb = args[0];
  if (!cb || (!Node.isArrowFunction(cb) && !Node.isFunctionExpression(cb))) return false;
  return (
    cb.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
    cb.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0
  );
}
