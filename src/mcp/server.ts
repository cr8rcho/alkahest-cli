import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runScan, loadOrScan } from "../core/pipeline.js";
import type { ProductMap, Screen } from "../core/types.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

/**
 * 에이전트(Claude Code/Codex/Cursor)가 제품 지도를 질의하는 MCP 서버 (ALKAHEST.md §7).
 * LLM 키 불필요 — 추론은 호출한 에이전트가 한다. 도구는 결정론적 구조만 제공.
 * 기본 대상은 서버 실행 디렉터리(cwd). 각 도구의 `path` 로 다른 프로젝트 지정 가능.
 */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "alkahest", version: pkg.version });
  const rootOf = (path?: string) => resolve(path ?? process.cwd());

  server.registerTool(
    "scan",
    {
      title: "Scan project",
      description:
        "React/Next 프로젝트를 정적 분석해 제품 지도(.alkahest/map.json + 대시보드)를 생성/갱신한다. " +
        "화면·화면간 이동·화면이 부르는 API/데이터 호출을 추출. 결과 요약(개수)을 반환.",
      inputSchema: { path: z.string().optional().describe("프로젝트 루트 (기본: cwd)") },
    },
    async ({ path }) => {
      const result = runScan(rootOf(path));
      if (!result) return text("화면을 찾지 못했습니다. Next app-router(app/ 또는 src/app/의 page.*)만 지원합니다.");
      const m = result.map;
      return json({
        framework: m.meta.framework,
        router: m.meta.router,
        screens: m.screens.length,
        resources: m.resources.length,
        transitions: m.transitions.length,
        calls: m.calls.length,
        mapPath: result.outFile,
      });
    },
  );

  server.registerTool(
    "overview",
    {
      title: "Product map overview",
      description:
        "제품 지도 전체 개요: 화면 목록(route/title/기능수)과 리소스 목록(라벨/호출하는 화면 수). " +
        "map.json 이 없으면 자동으로 스캔한다. 제품 구조를 한눈에 파악할 때 먼저 호출.",
      inputSchema: { path: z.string().optional() },
    },
    async ({ path }) => {
      const map = loadOrScan(rootOf(path));
      if (!map) return text("화면 없음 또는 미지원 프로젝트.");
      return json({
        framework: map.meta.framework,
        router: map.meta.router,
        screens: map.screens.map((s) => ({
          id: s.id,
          route: s.route,
          title: s.title,
          features: s.features.length,
          navigatesTo: map.transitions.filter((t) => t.from === s.id).length,
          calls: map.calls.filter((c) => c.from === s.id).length,
        })),
        resources: map.resources.map((r) => ({
          id: r.id,
          label: r.label,
          calledByScreens: new Set(map.calls.filter((c) => c.to === r.id).map((c) => c.from)).size,
        })),
      });
    },
  );

  server.registerTool(
    "get_screen",
    {
      title: "Screen detail",
      description:
        "한 화면의 전체 구조: UI 기능, 나가는/들어오는 이동, 부르는 리소스(API/데이터), 컴포넌트, 소스 위치. " +
        "이 데이터를 근거로 에이전트가 직접 요약이나 PRD를 작성하면 된다. 화면은 id/route/title 로 지정.",
      inputSchema: { screen: z.string().describe("화면 id / route / title"), path: z.string().optional() },
    },
    async ({ screen, path }) => {
      const map = loadOrScan(rootOf(path));
      if (!map) return text("화면 없음 또는 미지원 프로젝트.");
      const s = matchScreen(map, screen);
      if (!s) return text(`화면을 찾지 못함: ${screen}`);
      return json(screenDetail(map, s));
    },
  );

  server.registerTool(
    "who_calls",
    {
      title: "Resource callers (impact)",
      description:
        "특정 리소스(API 엔드포인트/데이터)를 부르는 화면들을 반환한다. 데이터 의존성·변경 영향 파악용. " +
        "리소스는 id('GET /api/orders') 또는 경로 일부('/api/orders')로 지정.",
      inputSchema: { resource: z.string(), path: z.string().optional() },
    },
    async ({ resource, path }) => {
      const map = loadOrScan(rootOf(path));
      if (!map) return text("화면 없음 또는 미지원 프로젝트.");
      const q = resource.toLowerCase();
      const matched = map.resources.filter(
        (r) => r.id.toLowerCase() === q || (r.path ?? "").toLowerCase().includes(q) || r.label.toLowerCase().includes(q),
      );
      return json(
        matched.map((r) => ({
          resource: r.label,
          callers: map.calls
            .filter((c) => c.to === r.id)
            .map((c) => ({ screen: c.from, via: c.trigger, loc: c.loc })),
        })),
      );
    },
  );

  return server;
}

// ---------- helpers ----------

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}
function json(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function matchScreen(map: ProductMap, arg: string): Screen | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/^\/+|\/+$/g, "");
  const t = norm(arg);
  return map.screens.find((s) => norm(s.id) === t || norm(s.route) === t || norm(s.title) === t);
}

function screenDetail(map: ProductMap, s: Screen) {
  const resourceLabel = (id: string) => map.resources.find((r) => r.id === id)?.label ?? id;
  return {
    id: s.id,
    route: s.route,
    title: s.title,
    sourceFile: s.sourceFile,
    summary: s.summary || null,
    features: s.features,
    components: s.components,
    navigatesTo: map.transitions
      .filter((t) => t.from === s.id)
      .map((t) => ({ to: t.to ?? t.rawTarget ?? "(미해결)", via: t.trigger, loc: t.loc })),
    navigatedFrom: map.transitions
      .filter((t) => t.to === s.id)
      .map((t) => ({ from: t.from, via: t.trigger, loc: t.loc })),
    calls: map.calls
      .filter((c) => c.from === s.id)
      .map((c) => ({ resource: c.to ? resourceLabel(c.to) : c.rawTarget ?? "(미해결)", via: c.trigger, loc: c.loc })),
  };
}
