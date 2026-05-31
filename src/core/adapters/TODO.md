# Adapter roadmap (TODO)

Planning doc for which platforms become `FrameworkAdapter`s. The goal is to cover
the stacks people actually reach for when building a website or an app.

**Shipping today:** `next` (App Router + Pages Router), `react-router` (Vite/CRA SPA), `react-native` (Expo Router + React Navigation), `swiftui` (SwiftUI).

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

### [ ] `react-router` — generic React SPA (Vite / CRA)
- **detect:** `react-router-dom` in deps; no Next.js.
- **screen:** route elements — `<Route path element>` (data router `createBrowserRouter` route objects, or JSX routes).
- **nav:** `<Link>/<NavLink to>`, `useNavigate()`, `<Navigate>`, `redirect()` (loaders).
- **calls:** `loader`/`action` fns, `fetch`, axios, `useQuery`.
- **note:** routes are declared, not file-based — `discover` parses the router config, not the filesystem.

### [ ] `vue` — Vue 3 + Vue Router (and Nuxt)
- **detect:** `vue` + `vue-router` in deps; Nuxt = `nuxt` dep or `pages/` with `.vue`.
- **screen:** Nuxt = file-based `pages/**/*.vue`; plain Vue = `vue-router` route config.
- **nav:** `<router-link to>`, `<NuxtLink>`, `router.push`, `navigateTo` (Nuxt).
- **calls:** `useFetch`/`useAsyncData` (Nuxt), `fetch`, `axios`, Pinia actions.
- **parse:** SFC `<script>`/`<template>` — needs a `.vue` block splitter before AST.

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

1. `next-pages` + `react-router` — unlock the rest of the React/web world with the existing parser.
2. `vue` (Nuxt) and `svelte` — next-biggest web ecosystems.
3. `react-native` / `expo` — reuses the JSX parser, opens the app market.
4. `flutter` + `compose` + `uikit` — the native app set (shared non-JS parsing baseline).
5. Tier 3 server-rendered / static — breadth and a graceful fallback.
