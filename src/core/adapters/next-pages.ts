import { statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FrameworkAdapter, ScreenFile } from "./types.js";
import { sourceFileFor, walk, parseReactScreen, titleFromRoute, isReactRouterSpa, isReactNativeApp, isVueApp } from "./react-jsx.js";

/**
 * Next.js pages-router adapter: treats `pages/**​/*.tsx` as screens (one file = one
 * route), parses with ts-morph. Screen id = route ("/blog/[slug]"). Entry = "/".
 * Excludes API routes and the framework files (_app/_document/_error).
 * JSX signal extraction is shared via react-jsx.ts; only file→route differs from next-app.
 */
const PAGE_RE = /\.(tsx|jsx|ts|js)$/;
const SPECIAL = /^_(app|document|error)$/;

function pagesDirOf(projectRoot: string): string | null {
  return (
    [join(projectRoot, "pages"), join(projectRoot, "src", "pages")].find(
      (d) => existsSync(d) && statSync(d).isDirectory(),
    ) ?? null
  );
}

export const nextPagesAdapter: FrameworkAdapter = {
  id: "next",
  router: "next-pages",

  detect(projectRoot) {
    return (
      pagesDirOf(projectRoot) !== null &&
      !isReactRouterSpa(projectRoot) &&
      !isReactNativeApp(projectRoot) &&
      !isVueApp(projectRoot)
    );
  },

  discover(projectRoot) {
    const pagesDir = pagesDirOf(projectRoot);
    if (!pagesDir) return [];
    const apiDir = join(pagesDir, "api");
    const files: ScreenFile[] = [];
    walk(pagesDir, (file) => {
      if (file.startsWith(apiDir + sep)) return; // API routes are not screens
      if (!PAGE_RE.test(file)) return;
      const base = file.slice(file.lastIndexOf(sep) + 1).replace(PAGE_RE, "");
      if (SPECIAL.test(base)) return; // _app / _document / _error
      const route = routeFromPageFile(pagesDir, file);
      files.push({
        absPath: file,
        relPath: relative(projectRoot, file).split(sep).join("/"),
        id: route,
        route,
        title: titleFromRoute(route),
        isEntry: route === "/", // pages-router entry point = root route
      });
    });
    files.sort((a, b) => a.route.localeCompare(b.route));
    return files;
  },

  parse(file) {
    return parseReactScreen(sourceFileFor(file.absPath));
  },
};

/** pages-router file path → route. `index` drops to its dir, keeps dynamic `[slug]`/`[...all]`. */
function routeFromPageFile(pagesDir: string, file: string): string {
  const segs = relative(pagesDir, file)
    .replace(PAGE_RE, "")
    .split(sep);
  if (segs[segs.length - 1] === "index") segs.pop();
  const route = "/" + segs.join("/");
  return route.length > 1 ? route.replace(/\/+$/, "") : "/";
}
