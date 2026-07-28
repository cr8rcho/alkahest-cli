import { statSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { FrameworkAdapter, RawNav, RawScreen, ScreenFile } from "./types.js";
import { normalizeRoute } from "../resolve.js";
import { sourceFileFor, walk, parseReactScreen, navTableEntries, renderedComponentFiles, titleFromRoute, isReactRouterSpa, isReactNativeApp, isVueApp, isAndroidApp, isRemixApp, isAstroApp, isAngularApp, isRailsApp } from "./react-jsx.js";

/**
 * Next.js app-router adapter: treats `app/**​/page.tsx` as screens, parses with ts-morph.
 * Screen id = route ("/dashboard/settings"). Entry point = root route "/".
 * JSX signal extraction is shared via react-jsx.ts.
 *
 * A screen's navigation is rarely all in its own `page.tsx`: the app shell (sidebar, tabs,
 * header) lives in a `layout.tsx`, and a page usually renders a section component that holds
 * the links. So parse gathers navs from the page file, the layouts that page OWNS (see
 * `ownedLayouts`), and the components any of those render, one hop out.
 */
const PAGE_RE = /^page\.(tsx|jsx|ts|js)$/;
const ROUTE_FILE_EXTS = [".tsx", ".jsx", ".ts", ".js"];

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
    return (
      appDirOf(projectRoot) !== null &&
      !isReactRouterSpa(projectRoot) &&
      !isReactNativeApp(projectRoot) &&
      !isVueApp(projectRoot) &&
      !isAndroidApp(projectRoot) &&
      !isRemixApp(projectRoot) &&
      !isAstroApp(projectRoot) &&
      !isAngularApp(projectRoot) &&
      !isRailsApp(projectRoot)
    );
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
    const screen = parseReactScreen(sourceFileFor(file.absPath));
    const root = projectRootOf(file);
    const seen = new Set(screen.navs.map(navKey));
    seen.add(file.id); // a shell links to the very page it wraps; that self-edge is not a transition
    const navs: RawNav[] = [...screen.navs, ...take(navTableEntries(sourceFileFor(file.absPath)), seen)];
    for (const src of contributingFiles(file, root)) navs.push(...navsFrom(src, root, seen));
    return { ...screen, navs } satisfies RawScreen;
  },

  deps(file) {
    return contributingFiles(file, projectRootOf(file));
  },
};

/** Files beyond the screen file whose navs count as this screen's: owned layouts + what they and the page render. */
function contributingFiles(file: ScreenFile, root: string): string[] {
  const appDir = appDirOf(root);
  if (!appDir) return [];
  const layouts = ownedLayouts(appDir, file.absPath);
  const out = new Set<string>(layouts);
  for (const src of [file.absPath, ...layouts])
    for (const dep of renderedComponentFiles(sourceFileFor(src))) out.add(dep);
  out.delete(file.absPath);
  return [...out];
}

/** Navs a contributing file adds: its own JSX links plus any nav table it declares. */
function navsFrom(absPath: string, root: string, seen: Set<string>): RawNav[] {
  const sf = sourceFileFor(absPath);
  const file = relative(root, absPath).split(sep).join("/");
  return take([...parseReactScreen(sf).navs, ...navTableEntries(sf)], seen).map((nav) => ({ ...nav, file }));
}

/** First nav per destination wins — the same target reached from both the shell and the page is one edge. */
function take(navs: RawNav[], seen: Set<string>): RawNav[] {
  const out: RawNav[] = [];
  for (const nav of navs) {
    const key = navKey(nav);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(nav);
  }
  return out;
}

/** Dedupe key: the destination as resolve will read it, so `/home?tab=a` and `/home` count once. */
const navKey = (nav: RawNav): string =>
  nav.target == null ? `raw:${nav.raw}` : nav.target.startsWith("/") ? normalizeRoute(nav.target) : nav.target;

/**
 * Layouts whose links belong to THIS screen: an ancestor `layout.*` is owned by the nearest
 * page route at or above it. So `app/home/(shell)/layout.tsx` attaches its sidebar to `/home`
 * and not to all fifteen pages under that shell — inheriting it everywhere would turn one
 * sidebar into a clique nobody can read.
 */
function ownedLayouts(appDir: string, pageFile: string): string[] {
  const route = routeFromAppFile(appDir, pageFile);
  const out: string[] = [];
  for (let dir = dirname(pageFile); dir.startsWith(appDir); dir = dirname(dir)) {
    const layout = ROUTE_FILE_EXTS.map((e) => join(dir, "layout" + e)).find((f) => existsSync(f));
    if (layout && nearestPageRoute(appDir, dir) === route) out.push(layout);
    if (dir === appDir) break;
  }
  return out;
}

/** Route of the closest `page.*` at or above `dir`, or null when a layout has no page of its own. */
function nearestPageRoute(appDir: string, dir: string): string | null {
  for (let d = dir; d.startsWith(appDir); d = dirname(d)) {
    const page = ROUTE_FILE_EXTS.map((e) => join(d, "page" + e)).find((f) => existsSync(f));
    if (page) return routeFromAppFile(appDir, page);
    if (d === appDir) break;
  }
  return null;
}

/** ScreenFile carries abs + project-relative paths but not the root; recover it by unwinding relPath. */
function projectRootOf(file: ScreenFile): string {
  let dir = dirname(file.absPath);
  for (let i = file.relPath.split("/").length - 1; i > 0; i--) dir = dirname(dir);
  return dir;
}

/** app-router file path → route. Strips route groups `(x)`, keeps dynamic `[slug]`. */
function routeFromAppFile(appDir: string, file: string): string {
  const segs = relative(appDir, file)
    .split(sep)
    .slice(0, -1)
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  const route = "/" + segs.join("/");
  return route.length > 1 ? route.replace(/\/+$/, "") : "/";
}
