/**
 * Alkahest core data model — the implementation of ALKAHEST.md §3.
 *
 * `map.json` is the canonical serialization of ProductMap; the dashboard (view)
 * and PRD generation (prd) all read this structure. If the model changes, update
 * ALKAHEST.md first.
 */

/** A source code location — clickable to jump in an editor. */
export interface SourceLoc {
  /** Path relative to the project root */
  file: string;
  line: number;
}

/**
 * One UI element inside a screen — something the user *sees or interacts with*.
 * The element's *effect* (navigating to another screen / calling a backend) is
 * NOT a Feature; it's represented as an edge (Transition / Call). (ALKAHEST.md §3)
 */
export interface Feature {
  kind: "form" | "button" | "input" | "list" | "conditional";
  /** Human-readable name — "Login form", "Checkout button" */
  label: string;
  /** Evidence: component/handler name, condition expression, etc. */
  detail: string;
  loc: SourceLoc;
}

/** A graph node = one screen (route/page). */
export interface Screen {
  /** Stable identifier based on the route path */
  id: string;
  /** "/dashboard/settings" */
  route: string;
  /** "app/dashboard/settings/page.tsx" (relative to project root) */
  sourceFile: string;
  /** File content hash for incremental refresh — ALKAHEST.md §9 */
  sourceHash: string;
  /** Human-readable screen name */
  title: string;
  /** Agent-written one-liner "what the user does on this screen" — empty until set via MCP */
  summary: string;
  /** Agent-written PRD/requirements markdown for this screen — empty until set via MCP. Shown in the dashboard panel. */
  prd?: string;
  features: Feature[];
  /** Names of the main components used on this screen */
  components: string[];
  /** Whether this is the app entry point (root launched by @main/App, or the "/" route). Marks the start point / layout root. */
  isEntry?: boolean;
}

/** Layer-1 edge = navigation from screen → screen (or an external URL). */
export interface Transition {
  from: string; // Screen.id
  /** Target Screen.id, or an external URL, or null if not statically resolved */
  to: string | null;
  /**
   * Edge kind:
   *  - "navigate": user-triggered navigation (Link/router.push/.sheet/NavigationLink, etc.)
   *  - "contains": a screen containing a child screen (TabView/embed) — structural flow, used to find the start point.
   */
  kind: "navigate" | "contains";
  /** Original expression text when unresolved (e.g. "router.push(path)") */
  rawTarget?: string;
  /** "<Link href>" | "router.push" | "form action" | "redirect()" | "<a href>" | "Tab"/"embed" */
  trigger: string;
  loc: SourceLoc;
}

/**
 * Layer-2 node = a backend/data capability a screen *calls* (ALKAHEST.md §3).
 * When several screens call the same resource they share one node → revealing "which screens use it together".
 */
export interface Resource {
  /** Stable identifier based on method+path or an identifiable name */
  id: string;
  kind: "endpoint" | "server-action" | "rpc" | "data-source" | "external";
  /** Human-readable name — "GET /api/orders" */
  label: string;
  /** HTTP method (when an endpoint) */
  method?: string;
  /** Path or URL — "/api/orders" */
  path?: string;
}

/** Layer-2 edge = call from screen → resource. */
export interface Call {
  from: string; // Screen.id
  /** Target Resource.id, or null if not statically resolved */
  to: string | null;
  /** Original expression text when unresolved */
  rawTarget?: string;
  /** "fetch" | "useQuery" | "useMutation" | "server action" | handler name, etc. */
  trigger: string;
  loc: SourceLoc;
}

export type Framework =
  | "next"
  | "react-router"
  | "vite-react"
  | "react-native"
  | "vue"
  | "nuxt"
  | "svelte"
  | "remix"
  | "astro"
  | "angular"
  | "static"
  | "swiftui"
  | "uikit"
  | "compose"
  | "flutter"
  | "django"
  | "flask"
  | "unknown";
export type Router =
  | "next-app"
  | "next-pages"
  | "react-router"
  | "expo-router"
  | "react-navigation"
  | "vue-router"
  | "nuxt-pages"
  | "sveltekit"
  | "remix-routes"
  | "astro-pages"
  | "angular-router"
  | "static-html"
  | "swiftui-views"
  | "uikit-vc"
  | "compose-nav"
  | "flutter-nav"
  | "django-urls"
  | "flask-routes"
  | "unknown";

export interface ProductMapMeta {
  framework: Framework;
  router: Router;
  /** ISO 8601 — scan time */
  scannedAt: string;
  /** Absolute path */
  projectRoot: string;
  /** Incremental baseline: per-file content hashes — ALKAHEST.md §9 */
  fileHashes: Record<string, string>;
  /** alkahest version that produced this map */
  alkahestVersion: string;
}

/** The full product map — the root of `.alkahest/map.json`. */
export interface ProductMap {
  /** Layer-1 nodes: screens */
  screens: Screen[];
  /** Layer-2 nodes: resources a screen calls (API/data/server action) */
  resources: Resource[];
  /** Layer-1 edges: screen → screen navigation */
  transitions: Transition[];
  /** Layer-2 edges: screen → resource calls */
  calls: Call[];
  meta: ProductMapMeta;
}
