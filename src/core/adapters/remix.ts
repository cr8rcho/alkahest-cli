import { readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FrameworkAdapter, ScreenFile } from "./types.js";
import { sourceFileFor, parseReactScreen, titleFromRoute, hasDependency } from "./react-jsx.js";

/**
 * Remix / React Router 7 (framework mode) adapter. File-based flat routes under `app/routes/`,
 * parsed with the shared React JSX parser (Remix screens are JSX, same as Next/React Router).
 *
 * Flat-route naming → route:
 *  - `.` separates path segments: `blog.$slug.tsx` → `/blog/:slug`
 *  - `_index` is the index route (collapses to its parent): `_index.tsx` → `/`, `blog._index.tsx` → `/blog`
 *  - a leading-underscore segment is a pathless layout (dropped): `_auth.login.tsx` → `/login`
 *  - `$param` → `:param`, bare `$` → `*` (splat)
 *  - folder form `routes/blog/route.tsx` is treated like `routes/blog.tsx`
 *  Screen id = route path; entry = "/".
 */
const ROUTE_RE = /\.(tsx|jsx|ts|js)$/;

function routesDirOf(projectRoot: string): string | null {
  return (
    [join(projectRoot, "app", "routes"), join(projectRoot, "src", "app", "routes")].find(
      (d) => existsSync(d) && statSync(d).isDirectory(),
    ) ?? null
  );
}

export const remixAdapter: FrameworkAdapter = {
  id: "remix",
  router: "remix-routes",

  detect(projectRoot) {
    return (
      hasDependency(projectRoot, "@remix-run/react", "@remix-run/node", "@remix-run/dev", "@react-router/dev") &&
      routesDirOf(projectRoot) !== null
    );
  },

  discover(projectRoot) {
    const routesDir = routesDirOf(projectRoot);
    if (!routesDir) return [];
    const files: ScreenFile[] = [];
    const seen = new Set<string>();

    for (const { abs, routeName } of routeModules(routesDir)) {
      const route = routeFromFlat(routeName);
      if (route == null || seen.has(route)) continue;
      seen.add(route);
      files.push({
        absPath: abs,
        relPath: relative(projectRoot, abs).split(sep).join("/"),
        id: route,
        route,
        title: titleFromRoute(route),
        isEntry: route === "/",
      });
    }
    files.sort((a, b) => a.route.localeCompare(b.route));
    return files;
  },

  parse(file) {
    return parseReactScreen(sourceFileFor(file.absPath));
  },
};

// ---------- route module enumeration ----------

/** Each route module = a flat file `routes/<name>.tsx` or a folder `routes/<name>/route.tsx`. */
function routeModules(routesDir: string): Array<{ abs: string; routeName: string }> {
  const out: Array<{ abs: string; routeName: string }> = [];
  for (const entry of safeReaddir(routesDir)) {
    if (entry.name.startsWith(".")) continue;
    const full = join(routesDir, entry.name);
    if (entry.isDirectory()) {
      const routeFile = ["route.tsx", "route.jsx", "route.ts", "route.js"]
        .map((f) => join(full, f))
        .find((f) => existsSync(f));
      if (routeFile) out.push({ abs: routeFile, routeName: entry.name });
    } else if (ROUTE_RE.test(entry.name)) {
      out.push({ abs: full, routeName: entry.name.replace(ROUTE_RE, "") });
    }
  }
  return out;
}

function safeReaddir(dir: string): import("node:fs").Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// ---------- flat-route name → route path ----------

/** Convert a Remix flat-route name (no extension) to a URL path. Null if it's not a routable module. */
function routeFromFlat(name: string): string | null {
  // Skip non-route conventions that sometimes live in routes/ as plain files.
  if (name === "root") return null;
  const segs: string[] = [];
  for (const raw of name.split(".")) {
    if (raw === "_index" || raw === "") continue; // index marker / empty
    if (raw.startsWith("_")) continue; // pathless layout segment (dropped from URL)
    if (raw === "$") {
      segs.push("*"); // splat
      continue;
    }
    if (raw.startsWith("$")) {
      segs.push(":" + raw.slice(1)); // $slug → :slug
      continue;
    }
    // `parent_` (trailing underscore = break out of layout nesting) keeps the literal sans the underscore
    segs.push(raw.replace(/_$/, ""));
  }
  const route = "/" + segs.join("/");
  return route.length > 1 ? route.replace(/\/+$/, "") : "/";
}
