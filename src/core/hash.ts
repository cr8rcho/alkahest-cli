import { createHash } from "node:crypto";

/** 파일 내용 해시 — 증분 갱신 기준선(ALKAHEST.md §9). 짧게 잘라 식별용으로만 쓴다. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}
