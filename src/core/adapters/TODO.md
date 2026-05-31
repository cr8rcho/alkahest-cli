# Adapter roadmap (TODO)

Planning doc for which platforms become `FrameworkAdapter`s. The goal is to cover
the stacks people actually reach for when building a website or an app.

**Shipping today:** `next` (App Router + Pages Router), `react-router` (Vite/CRA SPA), `react-native` (Expo Router + React Navigation), `vue`/`nuxt` (Vue Router + Nuxt), `swiftui` (SwiftUI).

React-family adapters share JSX signal extraction via `react-jsx.ts`
(`parseReactScreen` + `walk`/`project`); only file→screen discovery differs per adapter.

## How an adapter is defined (recap — see ALKAHEST.md §8)

Only `discover` + `parse` differ per platform; `resolve`/`emit`/`dashboard`/`mcp` are shared.
Adding one = a single `FrameworkAdapter` in this folder, registered in `ADAPTERS[]` (`index.ts`).

```ts
interface FrameworkAdapter {
  id: Framework;          // add the new id to Framework union in ../types.ts
  router: Router;         // add the routing label to Router union too
  detect(root): boolean;  // cheap probe — does this project look like ours?
  discover(root): ScreenFile[];   // enumerate screens (id/route/title/isEntry)
  parse(file): RawScreen;         // → navs / calls / features / contains
}
```

For every adapter below, the four things to nail down are:

1. **detect** — the file/dependency signal that says "this is the stack".
2. **screen** — what counts as a node (a route? a page file? a top-level component/view?).
3. **navigation** — the primitives that move between screens → `RawNav`.
4. **data calls** — the primitives that hit an API/data source → `RawCall`.
5. **features** — interactive bits worth surfacing (buttons, forms, lists, inputs).

Parsing approach is the adapter's choice (ts-morph/AST, tree-sitter, or regex line-scan,
like SwiftUI does).

---

## Tier 1 — web frameworks (highest reach, JS/TS, reuse the ts-morph parser)

### [x] `next-pages` — Next.js Pages Router ✅ shipped
- **detect:** `pages/` or `src/pages/` dir. (app-router is registered first, so a hybrid project maps as app-router.)
- **screen:** each `pages/**/*.{tsx,jsx,ts,js}` (except `_app`/`_document`/`_error`, `api/`) → route; `index` → its dir.
- **nav:** `<Link href>`, `<a href>`, `router.push/replace` — via shared `react-jsx.ts`.
- **calls:** `fetch`, query hooks — via shared `react-jsx.ts`. (`getServerSideProps`/`getStaticProps` not yet extracted.)
- **fixture:** `examples/pages-mini`.
- **follow-up:** `getServerSideProps`/`getStaticProps` data deps; treat `pages/api/*` as resource nodes.

### [x] `react-router` — generic React SPA (Vite / CRA) ✅ shipped
- **detect:** `react-router-dom`/`react-router` in deps; Next.js adapters take priority (they bow out via `isReactRouterSpa` only when react-router is present and `next` is not).
- **screen:** route → the component it renders, resolved to that component's source file. Routes are *declared*, so `discover` parses the router config (not the filesystem): `createBrowserRouter`/`createHashRouter`/`createMemoryRouter` route objects **and** JSX `<Routes><Route/>` (nested + `index` routes); `element={<X/>}` / `Component={X}`; `lazy(() => import("…"))`.
- **nav:** `<Link to>`, `<NavLink to>`, `useNavigate()`, `<Navigate to>` — via shared `react-jsx.ts`.
- **calls:** `fetch`, query hooks — via shared `react-jsx.ts`.
- **fixtures:** `examples/spa-mini` (data router + lazy + nested), `examples/spa-jsx-mini` (JSX form + index/nested).
- **follow-up:** `loader`/`action` data deps; `redirect()` inside loaders; framework-mode (Remix/RR7 file routes) is the separate `remix` adapter below.

### [x] `vue` — Vue 3 ✅ shipped (two adapters: `nuxt` + `vue-router`)
First non-React web platform. Can't reuse the JSX parser — an SFC is `<template>` + `<script>`,
not JSX — so `vue-sfc.ts` is a zero-dependency block-split + regex line-scan (SwiftUI's style).
- **`nuxt`** (`nuxt.ts`, file-based): `detect` = `nuxt` dep + `pages/` dir. Screen = `pages/**/*.vue`
  → route; `index.vue` collapses to its dir; `[id]`/`[...slug]` dynamic. Entry = "/".
- **`vue-router`** (`vue-router.ts`, config-based): `detect` = `vue-router` dep, not Nuxt. Routes are
  declared in a TS/JS config, so discover parses `routes:` arrays / `createRouter({routes})` with
  ts-morph, maps each route's `component` (static import **or** `() => import('…')`) to a `.vue` file
  (incl. `@/`,`~/` aliases → src root); nested `children` join through parent paths. Entry = "/".
- **shared SFC signals (`vue-sfc.ts`):** nav = `<router-link/NuxtLink to>`, `<a href>`,
  `router.push/replace`, `navigateTo()`; calls = `fetch`/`$fetch`/`useFetch`/`useAsyncData`/`axios`;
  features = `<button>`, `<input|textarea|select>`, `<form>`, `v-for` (list).
- **fixtures:** `examples/nuxt-mini` (file routes + NuxtLink + navigateTo + useFetch/useAsyncData),
  `examples/vue-spa-mini` (createRouter config, static+lazy components, nested children).
- **follow-up:** Pinia store actions as calls; named views (`components: {}`); `<script setup>` macro
  edge cases; route `name`-based nav (`router.push({name})`).

### [ ] `svelte` — SvelteKit
- **detect:** `@sveltejs/kit` in deps; `src/routes/` dir.
- **screen:** file-based `src/routes/**/+page.svelte` → route.
- **nav:** `<a href>` (SvelteKit intercepts), `goto()`.
- **calls:** `+page.(server.)ts` `load`, `fetch`, form actions.

### [ ] `angular` — Angular Router
- **detect:** `@angular/core` in deps; `angular.json`.
- **screen:** routes from `RouterModule.forRoot([...])` / standalone `provideRouter`.
- **nav:** `routerLink`, `Router.navigate()`.
- **calls:** `HttpClient` (`http.get/post`), resolvers.
- **note:** decorators + DI — heavier parse; AST over `.ts`, component templates may be inline or `.html`.

### [ ] `remix` — Remix / React Router 7 (framework mode)
- **detect:** `@remix-run/*` or RR7 framework config; `app/routes/`.
- **screen:** file-based `app/routes/*` → route.
- **nav:** `<Link>`, `useNavigate`, `redirect`.
- **calls:** route `loader`/`action`, `fetch`.

---

## Tier 2 — native & cross-platform apps

### [x] `react-native` — React Native ✅ shipped (two adapters, both id `react-native`)
Shipped as two adapters because the routing models — and therefore the `router` label — differ:
- **`expo-router`** (file-based, `expo-router.ts`): `detect` = `expo-router` dep + `app/` dir.
  Screen = `app/**/*.{tsx,jsx,ts,js}` → route, excluding `_layout` and Expo `+`-prefixed files;
  route groups `(x)` stripped, `index` collapses to its dir, `[slug]`/`[...all]` dynamic.
  Nav: `<Link href>`, `useRouter().push/replace/navigate`, and the global `router` from `expo-router`.
- **`react-navigation`** (config-based, `react-navigation.ts`): `detect` = `@react-navigation/native` dep.
  Screen = `<*.Screen name component>` registrations (Stack/Tab/Drawer); name→component resolved to a
  source file via shared `importMap`/`resolveComponentFile`. Entry = nearest `<*.Navigator initialRouteName>`,
  else first registered. Nav: `navigation.navigate/push/replace("ScreenName")` — targets the route name.
- **shares:** the react-jsx parser; `navigation.*` + expo `router` nav primitives were added there.
- **detection:** Next adapters bow out for RN via `isReactNativeApp()` (Expo's `app/` dir would otherwise
  look like Next app-router); `expo-router` is registered before `react-navigation` (Expo pulls in
  @react-navigation transitively).
- **fixtures:** `examples/expo-mini` (file routes, route group, `+not-found`/`_layout` excluded),
  `examples/rn-nav-mini` (Stack.Navigator + initialRouteName + component refs).
- **follow-up:** dynamic `Stack.Screen` children (render-prop screens); `getComponent` lazy form; deep links.

### [ ] `flutter` — Flutter (Dart)
- **detect:** `pubspec.yaml` with `flutter:` SDK.
- **screen:** `Widget`/`StatelessWidget`/`StatefulWidget` that are full pages; or GoRouter `GoRoute` config.
- **nav:** `Navigator.push/pushNamed`, `context.go/push` (go_router).
- **calls:** `http`/`dio` calls, `FutureBuilder`.
- **parse:** Dart — tree-sitter-dart or regex line-scan (mirror the SwiftUI heuristic approach).

### [ ] `compose` — Android Jetpack Compose (Kotlin)
- **detect:** `*.kt` with `androidx.compose` imports; `build.gradle` Compose plugin.
- **screen:** `@Composable` functions used as `NavHost` destinations (`composable("route") { ... }`).
- **nav:** `navController.navigate("route")`.
- **calls:** Retrofit/Ktor client calls, `ViewModel` repository calls.
- **parse:** Kotlin — tree-sitter-kotlin or regex; pairs naturally with the SwiftUI adapter as the "native mobile" set.

### [ ] `uikit` — iOS UIKit (Swift, storyboard + programmatic)
- **detect:** Swift project, `import UIKit`, `UIViewController` subclasses / `.storyboard`.
- **screen:** each `UIViewController` subclass; storyboard scenes.
- **nav:** `pushViewController`, `present`, segues (`performSegue`, storyboard segue defs).
- **calls:** `URLSession`, Alamofire.
- **note:** complements `swiftui`; many apps are mixed — consider letting both run and merge.

---

## Tier 3 — server-rendered / template / no-build sites

### [ ] `astro` — Astro
- **detect:** `astro` in deps; `src/pages/**/*.astro`.
- **screen:** file-based `src/pages/**` → route (`.astro`, `.md`, `.mdx`).
- **nav:** `<a href>` (mostly static links).
- **calls:** frontmatter `fetch`, content collections, `src/pages/api/*`.

### [ ] `django` / `flask` — Python server-rendered
- **detect:** `manage.py` + `urls.py` (Django); `Flask(__name__)` + `@app.route` (Flask).
- **screen:** URL patterns → view fns/classes → rendered templates.
- **nav:** `{% url %}` / `url_for()` links in templates; redirects.
- **calls:** ORM queries / external HTTP inside views.
- **parse:** Python AST (`ast` via a sidecar) or regex; templates are Jinja/DTL.

### [ ] `rails` — Ruby on Rails
- **detect:** `config/routes.rb`, `Gemfile` with `rails`.
- **screen:** `routes.rb` entries → controller actions → views (`app/views/**`).
- **nav:** `link_to`, `redirect_to`, path helpers.
- **calls:** ActiveRecord / external HTTP in controllers.

### [ ] `static-html` — plain multi-page HTML sites
- **detect:** loose `*.html` files with `<a href>` cross-links, no framework deps.
- **screen:** each `.html` file → page.
- **nav:** `<a href="other.html">`.
- **calls:** `<script>` `fetch`/XHR, `<form action>`.
- **note:** lowest-fidelity fallback; useful so "any folder of pages" still yields a map.

---

## Cross-cutting work (do alongside the first 2–3 new adapters)

- [ ] **Multi-adapter projects:** `selectAdapter()` returns the *first* match — a mixed
      app (SwiftUI + UIKit, Next `app/` + `pages/`) only gets one. Decide: priority-only,
      or merge results from all matching adapters. (Next-vs-SPA disambiguation already
      handled via `isReactRouterSpa()`; see react-router above.)
- [ ] **Non-JS parsing baseline:** pick one of tree-sitter (Dart/Kotlin/Swift/Python) vs.
      per-language regex heuristics, so Tier 2/3 adapters don't each reinvent it.
- [ ] **`detect()` cost:** today some adapters walk the whole tree to probe. For more
      adapters, cap detection to manifest/dependency checks where possible.
- [ ] **`Framework`/`Router` unions:** every new adapter adds an `id` + `router` label in
      `../types.ts`; keep the dashboard legend in the `alkahest` renderer in sync.
- [ ] **Fixtures:** each adapter needs an `examples/` project so `scan` output is testable.

## Suggested order

✅ Done: `next-pages` + `react-router` (React/web), `vue`/`nuxt` (Vue), `react-native` (expo-router + react-navigation).

Remaining:
1. `svelte` — biggest remaining web ecosystem; `.svelte` block-scan (mirror `vue-sfc.ts`).
2. `remix` + `static-html` — cheapest wins: `remix` reuses the JSX parser (file routes), `static-html` is a regex fallback.
3. `astro` + `angular` — more web: `.astro` block-scan; Angular reuses ts-morph but needs decorator/DI handling.
4. `compose` + `uikit` + `flutter` — the native app set (pairs with `swiftui`; pick the non-JS parsing baseline first — tree-sitter vs. per-language regex).
5. Tier 3 server-rendered (`django`/`flask`, `rails`) — breadth.
