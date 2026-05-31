import { statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FrameworkAdapter, ScreenFile } from "./types.js";
import { sourceFileFor, walk, parseReactScreen, titleFromRoute, hasDependency } from "./react-jsx.js";

/**
 * Expo Router adapter (React Native, file-based). Like Next's app-router but every route
 * file is a screen: `app/**​/*.{tsx,jsx,ts,js}` → route, excluding layouts (`_layout`) and
 * Expo's special `+`-prefixed files (`+html`, `+not-found`, `+native-intent`).
 * Screen id = route; route groups `(x)` are stripped; `index` collapses to its dir.
 * JSX signal extraction (incl. <Link href>, router.push, navigation.navigate) is shared.
 */
const ROUTE_RE = /\.(tsx|jsx|ts|js)$/;

function appDirOf(projectRoot: string): string | null {
  return (
    [join(projectRoot, "app"), join(projectRoot, "src", "app")].find(
      (d) => existsSync(d) && statSync(d).isDirectory(),
    ) ?? null
  );
}

export const expoRouterAdapter: FrameworkAdapter = {
  id: "react-native",
  router: "expo-router",

  detect(projectRoot) {
    return hasDependency(projectRoot, "expo-router") && appDirOf(projectRoot) !== null;
  },

  discover(projectRoot) {
    const appDir = appDirOf(projectRoot);
    if (!appDir) return [];
    const files: ScreenFile[] = [];
    walk(appDir, (file) => {
      if (!ROUTE_RE.test(file)) return;
      const base = file.slice(file.lastIndexOf(sep) + 1).replace(ROUTE_RE, "");
      if (base === "_layout" || base.startsWith("+")) return; // layouts & Expo special files
      const route = routeFromAppFile(appDir, file);
      files.push({
        absPath: file,
        relPath: relative(projectRoot, file).split(sep).join("/"),
        id: route,
        route,
        title: titleFromRoute(route),
        isEntry: route === "/", // app/index → "/"
      });
    });
    files.sort((a, b) => a.route.localeCompare(b.route));
    return files;
  },

  parse(file) {
    return parseReactScreen(sourceFileFor(file.absPath));
  },
};

/** Expo route file → route. Strips route groups `(x)`, collapses `index`, keeps dynamic `[slug]`/`[...all]`. */
function routeFromAppFile(appDir: string, file: string): string {
  const segs = relative(appDir, file)
    .replace(ROUTE_RE, "")
    .split(sep)
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  if (segs[segs.length - 1] === "index") segs.pop();
  const route = "/" + segs.join("/");
  return route.length > 1 ? route.replace(/\/+$/, "") : "/";
}
