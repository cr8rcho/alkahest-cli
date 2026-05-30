import type { FrameworkAdapter } from "./types.js";
import { nextAppAdapter } from "./next-app.js";
import { swiftUiAdapter } from "./swiftui.js";

export type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/** 등록된 어댑터 (감지 우선순위 순). 새 플랫폼은 여기에 추가. */
export const ADAPTERS: FrameworkAdapter[] = [nextAppAdapter, swiftUiAdapter];

/** 프로젝트에 맞는 첫 어댑터. 없으면 null. */
export function selectAdapter(projectRoot: string): FrameworkAdapter | null {
  return ADAPTERS.find((a) => a.detect(projectRoot)) ?? null;
}
