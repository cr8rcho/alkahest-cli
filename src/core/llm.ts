import Anthropic from "@anthropic-ai/sdk";
import type { ProductMap, Screen } from "./types.js";

/** ALKAHEST.md §7: summaries & PRDs via Claude. Latest model. */
const MODEL = "claude-opus-4-8";

/** Check used to gracefully skip the LLM step when no key is set. */
export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Default client; reads ANTHROPIC_API_KEY from the environment. */
function client(): Anthropic {
  return new Anthropic();
}

/** Compact per-screen context for the LLM (saves tokens, keeps it grounded). */
function screenContext(map: ProductMap, s: Screen) {
  const resourceLabel = (id: string) => map.resources.find((r) => r.id === id)?.label ?? id;
  return {
    route: s.route,
    title: s.title,
    features: s.features.map((f) => ({ kind: f.kind, label: f.label })),
    components: s.components,
    navigatesTo: map.transitions
      .filter((t) => t.from === s.id)
      .map((t) => ({ to: t.to ?? t.rawTarget ?? "(unresolved)", via: t.trigger })),
    navigatedFrom: map.transitions
      .filter((t) => t.to === s.id)
      .map((t) => ({ from: t.from, via: t.trigger })),
    calls: map.calls
      .filter((c) => c.from === s.id)
      .map((c) => ({ resource: c.to ? resourceLabel(c.to) : c.rawTarget ?? "(unresolved)", via: c.trigger })),
  };
}

// ---------- Summaries (batched, structured output) ----------

const SUMMARY_SYSTEM = `You are a product analyst. You receive structural data for React/Next screens
extracted by static analysis. For each screen, summarize "what the user can do on this screen"
in 1-2 PM-friendly English sentences.
- Describe it from a user/product perspective, not in code terms.
- Ground it in features (forms, buttons, lists, conditionals), navigatesTo (navigation), and
  calls (API/data calls), but synthesize naturally rather than listing them.
- For screens with thin data, don't over-invent — say only what can be inferred.
Always output according to the given JSON schema.`;

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
 * Summarize the given screens in a single call → map of screenId → summary.
 * Pass `targets` to summarize a subset (only changed screens during incremental
 * scans). Context is always built from the full map.
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

// ---------- PRD (per-screen markdown) ----------

const PRD_SYSTEM = `You are a senior product manager. Given the structural data of a single screen
extracted by static analysis, write a draft PRD/requirements doc for that screen as English markdown.
Include these sections:

# <Screen Title> PRD
## Overview
## What the user can do
## Screen flow (incoming / outgoing navigation)
## Data & API dependencies
## Functional requirements (checklist)
## Edge cases & open questions

Rules:
- State plainly what is clearly readable from the code; mark inferences as "(inferred)".
- Don't invent facts not present in the data. If unknown, put it under "open questions".
- Write functional requirements as verifiable statements.`;

/** Generate the PRD markdown for one screen. */
export async function generatePrd(map: ProductMap, screen: Screen): Promise<string> {
  const ctx = { id: screen.id, ...screenContext(map, screen) };
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [{ type: "text", text: PRD_SYSTEM, cache_control: { type: "ephemeral" } }],
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    messages: [{ role: "user", content: `Write the PRD for this screen:\n\n${JSON.stringify(ctx, null, 2)}` }],
  });
  return res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
