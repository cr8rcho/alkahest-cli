import { statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FrameworkAdapter, ScreenFile } from "./types.js";
import { project, walk, parseReactScreen } from "./react-jsx.js";

/**
 * Next.js app-router adapter: treats `app/**​/page.tsx` as screens, parses with ts-morph.
 * Screen id = route ("/dashboard/settings"). Entry point = root route "/".
 * JSX signal extraction is shared via react-jsx.ts.
 */
const PAGE_RE = /^page\.(tsx|jsx|ts|js)$/;

function appDirOf(projectRoot: string): string | null {
  return (
    [join(projectRoot, "app"), join(projectRoot, "src", "app")].find(
      (d) => existsSync(d) && statSync(d).isDirectory(),
    ) ?? null
  );
}

export const nextAppAdapter: FrameworkAdapter = {
  id: "next",
  router: "next-app",

  detect(projectRoot) {
    return appDirOf(projectRoot) !== null;
  },

  discover(projectRoot) {
    const appDir = appDirOf(projectRoot);
    if (!appDir) return [];
    const files: ScreenFile[] = [];
    walk(appDir, (file) => {
      const base = file.slice(file.lastIndexOf(sep) + 1);
      if (!PAGE_RE.test(base)) return;
      const route = routeFromAppFile(appDir, file);
      files.push({
        absPath: file,
        relPath: relative(projectRoot, file).split(sep).join("/"),
        id: route,
        route,
        title: titleFromRoute(route),
        isEntry: route === "/", // app-router entry point = root route
      });
    });
    files.sort((a, b) => a.route.localeCompare(b.route));
    return files;
  },

  parse(file) {
    return parseReactScreen(project().addSourceFileAtPath(file.absPath));
  },
};

/** app-router file path → route. Strips route groups `(x)`, keeps dynamic `[slug]`. */
function routeFromAppFile(appDir: string, file: string): string {
  const segs = relative(appDir, file)
    .split(sep)
    .slice(0, -1)
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  const route = "/" + segs.join("/");
  return route.length > 1 ? route.replace(/\/+$/, "") : "/";
}

function titleFromRoute(route: string): string {
  if (route === "/") return "Home";
  const last = route.split("/").filter(Boolean).pop() ?? route;
  return last
    .replace(/^\[(\.\.\.)?(.+?)\]$/, "$2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
