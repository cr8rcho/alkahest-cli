import { statSync, existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FrameworkAdapter, ScreenFile } from "./types.js";
import { walkVue, safeReadVue, parseVueSfc, titleFromRoute } from "./vue-sfc.js";

/**
 * Nuxt adapter (Vue, file-based). `pages/**​/*.vue` → routes, mirroring Nuxt's filesystem
 * router. Screen id = route ("/users/[id]"); `index.vue` collapses to its dir; dynamic
 * `[id]`/`[...slug]` kept. Entry = "/". SFC signal extraction is shared via vue-sfc.ts.
 */
function pagesDirOf(projectRoot: string): string | null {
  return (
    [join(projectRoot, "pages"), join(projectRoot, "src", "pages")].find(
      (d) => existsSync(d) && statSync(d).isDirectory(),
    ) ?? null
  );
}

function hasNuxtDep(projectRoot: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return "nuxt" in deps;
  } catch {
    return false;
  }
}

export const nuxtAdapter: FrameworkAdapter = {
  id: "nuxt",
  router: "nuxt-pages",

  detect(projectRoot) {
    return hasNuxtDep(projectRoot) && pagesDirOf(projectRoot) !== null;
  },

  discover(projectRoot) {
    const pagesDir = pagesDirOf(projectRoot);
    if (!pagesDir) return [];
    const files: ScreenFile[] = [];
    walkVue(pagesDir, (file) => {
      const route = routeFromPageFile(pagesDir, file);
      files.push({
        absPath: file,
        relPath: relative(projectRoot, file).split(sep).join("/"),
        id: route,
        route,
        title: titleFromRoute(route),
        isEntry: route === "/",
      });
    });
    files.sort((a, b) => a.route.localeCompare(b.route));
    return files;
  },

  parse(file) {
    return parseVueSfc(safeReadVue(file.absPath));
  },
};

/** Nuxt page file → route. `index` collapses to its dir; keeps dynamic `[id]`/`[...slug]`. */
function routeFromPageFile(pagesDir: string, file: string): string {
  const segs = relative(pagesDir, file).replace(/\.vue$/, "").split(sep);
  if (segs[segs.length - 1] === "index") segs.pop();
  const route = "/" + segs.join("/");
  return route.length > 1 ? route.replace(/\/+$/, "") : "/";
}
