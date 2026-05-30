import Anthropic from "@anthropic-ai/sdk";
import type { ProductMap, Screen } from "./types.js";

/** ALKAHEST.md §7: 요약·PRD는 Claude로. 최신 모델. */
const MODEL = "claude-opus-4-8";

/** 키가 없으면 LLM 단계를 우아하게 건너뛰기 위한 확인. */
export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** ANTHROPIC_API_KEY 를 환경에서 읽는 기본 클라이언트. */
function client(): Anthropic {
  return new Anthropic();
}

/** LLM 에 넘길 화면별 압축 컨텍스트 (토큰 절약 + 근거 집중). */
function screenContext(map: ProductMap, s: Screen) {
  const resourceLabel = (id: string) => map.resources.find((r) => r.id === id)?.label ?? id;
  return {
    route: s.route,
    title: s.title,
    features: s.features.map((f) => ({ kind: f.kind, label: f.label })),
    components: s.components,
    navigatesTo: map.transitions
      .filter((t) => t.from === s.id)
      .map((t) => ({ to: t.to ?? t.rawTarget ?? "(미해결)", via: t.trigger })),
    navigatedFrom: map.transitions
      .filter((t) => t.to === s.id)
      .map((t) => ({ from: t.from, via: t.trigger })),
    calls: map.calls
      .filter((c) => c.from === s.id)
      .map((c) => ({ resource: c.to ? resourceLabel(c.to) : c.rawTarget ?? "(미해결)", via: c.trigger })),
  };
}

// ---------- 요약 (배치, 구조화 출력) ----------

const SUMMARY_SYSTEM = `당신은 제품 분석가입니다. 정적 분석으로 추출한 React/Next 화면들의 구조 데이터를 받습니다.
각 화면에 대해 "이 화면에서 사용자가 무엇을 할 수 있는가"를 PM이 읽기 좋은 한국어 1~2문장으로 요약하세요.
- 코드 용어가 아니라 사용자/제품 관점으로 서술합니다.
- features(폼·버튼·리스트·조건), navigatesTo(이동), calls(API/데이터 호출)를 근거로 삼되 나열하지 말고 자연스럽게 종합합니다.
- 데이터가 빈약한 화면은 무리하게 지어내지 말고 알 수 있는 만큼만 적습니다.
반드시 주어진 JSON 스키마에 맞춰 출력하세요.`;

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summaries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          summary: { type: "string" },
        },
        required: ["id", "summary"],
      },
    },
  },
  required: ["summaries"],
} as const;

/**
 * 주어진 화면들을 한 번의 호출로 요약 → screenId → summary 맵.
 * `targets` 로 일부만 요약(증분 시 변경된 화면만). 컨텍스트는 항상 전체 map 기준.
 */
export async function summarizeScreens(map: ProductMap, targets: Screen[] = map.screens): Promise<Map<string, string>> {
  if (!targets.length) return new Map();
  const input = targets.map((s) => ({ id: s.id, ...screenContext(map, s) }));
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [{ type: "text", text: SUMMARY_SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
    messages: [{ role: "user", content: JSON.stringify(input) }],
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "{}";
  const parsed = JSON.parse(text) as { summaries: Array<{ id: string; summary: string }> };
  return new Map(parsed.summaries.map((x) => [x.id, x.summary]));
}

// ---------- PRD (화면별 마크다운) ----------

const PRD_SYSTEM = `당신은 시니어 프로덕트 매니저입니다. 정적 분석으로 추출한 한 화면의 구조 데이터를 받아,
그 화면의 PRD/요구사항 초안을 한국어 마크다운으로 작성합니다. 다음 섹션을 포함하세요:

# <화면 제목> PRD
## 개요
## 사용자가 할 수 있는 것
## 화면 흐름 (들어오는/나가는 이동)
## 데이터 · API 의존성
## 기능 요구사항 (체크리스트)
## 엣지 케이스 · 열린 질문

규칙:
- 코드에서 확실히 읽히는 것은 단정하고, 추론은 "(추정)"으로 표시합니다.
- 데이터에 없는 사실을 지어내지 마세요. 모르면 "열린 질문"에 넣습니다.
- 기능 요구사항은 검증 가능한 문장으로 작성합니다.`;

/** 한 화면의 PRD 마크다운 생성. */
export async function generatePrd(map: ProductMap, screen: Screen): Promise<string> {
  const ctx = { id: screen.id, ...screenContext(map, screen) };
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [{ type: "text", text: PRD_SYSTEM, cache_control: { type: "ephemeral" } }],
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    messages: [{ role: "user", content: `다음 화면의 PRD를 작성하세요:\n\n${JSON.stringify(ctx, null, 2)}` }],
  });
  return res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
