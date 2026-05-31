import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RawScreen, RawFeature } from "./types.js";

/**
 * Shared Vue Single-File-Component parsing for the Vue-family adapters (nuxt, vue-router).
 * Vue can't reuse the React JSX parser — an SFC is `<template>` + `<script>` blocks, not JSX —
 * so this is a zero-dependency line/regex scan in the SwiftUI adapter's style. Only file→screen
 * discovery differs per adapter; the SFC signal extraction below is shared.
 *
 * Mapping:
 *  - nav (template): <router-link to> / <NuxtLink to> / <a href>
 *  - nav (script): router.push/replace(...) / navigateTo("…") (Nuxt) / <Navigate>-less
 *  - call (script): fetch / useFetch / useAsyncData / $fetch / axios
 *  - feature (template): <button>, <input|textarea|select>, <form>, v-for (list)
 */

// ---------- SFC block splitting ----------

export interface SfcBlocks {
  template: string;
  script: string;
}

/** Extract the outer <template> and <script> blocks of an SFC (first of each). */
export function splitSfc(src: string): SfcBlocks {
  return { template: blockBody(src, "template"), script: blockBody(src, "script") };
}

/** Body of the first `<tag …>…</tag>` block, empty string if absent. */
function blockBody(src: string, tag: string): string {
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "i").exec(src);
  if (!open) return "";
  const start = open.index + open[0].length;
  const end = src.toLowerCase().indexOf(`</${tag}>`, start);
  return end === -1 ? src.slice(start) : src.slice(start, end);
}

// ---------- signal extraction ----------

const FEATURE_RULES: Array<{ re: RegExp; kind: RawFeature["kind"]; label: (m: RegExpMatchArray) => string }> = [
  { re: /<button\b[^>]*>([^<]*)/i, kind: "button", label: (m) => m[1].trim() || "Button" },
  { re: /<(?:input|textarea|select)\b[^>]*\bplaceholder=["']([^"']*)["']/i, kind: "input", label: (m) => m[1] || "Input" },
  { re: /<(?:input|textarea|select)\b/i, kind: "input", label: () => "Input" },
  { re: /<form\b/i, kind: "form", label: () => "Form" },
  { re: /\bv-for\b/i, kind: "list", label: () => "List" },
];

/** Parse one SFC's source into raw nav/call/feature signals. `componentTags` (PascalCase) → contains candidates. */
export function parseVueSfc(src: string): RawScreen {
  const { template, script } = splitSfc(src);
  const navs: RawScreen["navs"] = [];
  const calls: RawScreen["calls"] = [];
  const features: RawScreen["features"] = [];
  const components = new Set<string>();

  // ----- template: navigation links + features + child components -----
  let lineNo = 0;
  const templateStart = src.split(/\r?\n/).findIndex((l) => /<template/i.test(l));
  for (const rawLine of template.split(/\r?\n/)) {
    lineNo++;
    const line = rawLine.trim();
    const absLine = (templateStart >= 0 ? templateStart + 1 : 0) + lineNo;

    // <router-link to="…"> / <NuxtLink to="…"> / <a href="…"> (also :to bound to a string literal)
    const linkMatch =
      line.match(/<(?:router-link|NuxtLink)\b[^>]*?\s:?to=["']([^"']+)["']/i) ||
      line.match(/<a\b[^>]*?\shref=["'](\/[^"']*)["']/i);
    if (linkMatch) {
      const isAnchor = /^<a\b/i.test(line);
      navs.push({ target: linkMatch[1], raw: snippet(line), trigger: isAnchor ? "<a href>" : "<router-link to>", line: absLine });
    }

    for (const rule of FEATURE_RULES) {
      const m = line.match(rule.re);
      if (m) features.push({ kind: rule.kind, label: rule.label(m), detail: m[0].trim().slice(0, 40), line: absLine });
    }

    // child component usage: <PascalCase ...> or <kebab-case> mapped loosely → contains candidates
    for (const cm of line.matchAll(/<([A-Z]\w*)\b/g)) components.add(cm[1]);
  }

  // ----- script: programmatic nav + data calls -----
  let sLine = 0;
  const scriptStart = src.split(/\r?\n/).findIndex((l) => /<script/i.test(l));
  for (const rawLine of script.split(/\r?\n/)) {
    sLine++;
    const line = rawLine.trim();
    const absLine = (scriptStart >= 0 ? scriptStart + 1 : 0) + sLine;

    // router.push("/x") / router.replace("/x") / navigateTo("/x") (Nuxt) — string-literal targets
    const navMatch =
      line.match(/\b(?:router|this\.\$router)\.(push|replace)\s*\(\s*["']([^"']+)["']/) ||
      line.match(/\bnavigateTo\s*\(\s*["']([^"']+)["']/);
    if (navMatch) {
      const target = navMatch[2] ?? navMatch[1];
      const trigger = navMatch[2] ? `router.${navMatch[1]}` : "navigateTo()";
      navs.push({ target, raw: snippet(line), trigger, line: absLine });
    }

    // data calls: fetch / $fetch / useFetch / useAsyncData / axios — string-literal URL when present
    const callMatch = line.match(/\b(\$fetch|fetch|useFetch|useAsyncData|axios(?:\.\w+)?)\s*\(\s*["']([^"']+)["']/);
    if (callMatch) {
      calls.push({ url: callMatch[2], raw: snippet(line), trigger: callMatch[1], line: absLine });
    } else {
      const bare = line.match(/\b(useFetch|useAsyncData)\s*\(/);
      if (bare) calls.push({ url: null, raw: snippet(line), trigger: bare[1], line: absLine });
    }
  }

  return { navs, calls, features, components: [...components].sort(), contains: [] };
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? flat.slice(0, 77) + "..." : flat;
}

/** Last path segment → Title Case, unwrapping dynamic `[id]`/`:id`. */
export function titleFromRoute(route: string): string {
  if (route === "/" || route === "") return "Home";
  const last = route.split("/").filter(Boolean).pop() ?? route;
  return last
    .replace(/^\[(\.\.\.)?(.+?)\]$/, "$2") // [id] / [...all] → id / all
    .replace(/^:(.+)$/, "$1") // :id → id
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- shared fs helpers ----------

/** Recursively visit every `.vue` file under `dir`, skipping node_modules and dotfiles. */
export function walkVue(dir: string, onFile: (file: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkVue(full, onFile);
    else if (entry.name.endsWith(".vue")) onFile(full);
  }
}

export function safeReadVue(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Resolve a relative `.vue` import specifier (from `fromDir`) to a file on disk, or null. */
export function resolveVueFile(fromDir: string, spec: string | undefined, aliasRoot: string): string | null {
  if (!spec) return null;
  let base: string;
  if (spec.startsWith("@/") || spec.startsWith("~/")) base = resolve(aliasRoot, spec.slice(2)); // @/ and ~/ → src root
  else if (spec.startsWith(".")) base = resolve(fromDir, spec);
  else return null;
  const candidates = spec.endsWith(".vue") ? [base] : [base + ".vue", join(base, "index.vue")];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}
