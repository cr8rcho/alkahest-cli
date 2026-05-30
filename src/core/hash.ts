import { createHash } from "node:crypto";

/** File content hash — baseline for incremental updates (ALKAHEST.md §9). Truncated short, used only for identity. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}
