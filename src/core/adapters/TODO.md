# Adapter roadmap (TODO)

Planning doc for which platforms become `FrameworkAdapter`s. The goal is to cover
the stacks people actually reach for when building a website or an app.

**Shipping today:** `next` (App Router + Pages Router), `react-router` (Vite/CRA SPA), `remix` (Remix / RR7), `vue`/`nuxt` (Vue Router + Nuxt), `svelte` (SvelteKit), `astro` (Astro), `react-native` (Expo Router + React Navigation), `swiftui` (iOS) + `uikit` (iOS UIKit), `compose` (Android), `static-html` (plain HTML).

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

### [x] `svelte` — SvelteKit ✅ shipped (`sveltekit.ts`)
- **detect:** `@sveltejs/kit` in deps + a `src/routes/` (or `routes/`) dir.
- **screen:** `src/routes/**/+page.svelte` → route (file-based). Route groups `(x)` stripped, `[id]`/`[...rest]` kept, `index`-less; `+layout`/`+page.server.ts` etc. excluded. id = route, entry = "/".
- **parse:** `.svelte` can't reuse the JSX or Vue parsers (it's `<script>` + Svelte markup) — zero-dependency line/regex scan (SwiftUI/Vue-SFC style).
- **nav:** `<a href="/x">` (markup), `goto("/x")` from `$app/navigation` (script).
- **calls:** `fetch("…")`. **features:** `<button>`, `<input|textarea|select>`, `<form>`, `{#each}` (list).
- **fixture:** `examples/svelte-mini` (4 routes incl. nested `blog/[slug]`, `+layout` excluded, goto + a-href nav, fetch call). Deterministic 5/5.
- **follow-up:** `load()` data deps in `+page(.server).ts`; form actions; `<svelte:component>`; route `name` params.
### [ ] `angular` — Angular Router
- **detect:** `@angular/core` in deps; `angular.json`.
- **screen:** routes from `RouterModule.forRoot([...])` / standalone `provideRouter`.
- **nav:** `routerLink`, `Router.navigate()`.
- **calls:** `HttpClient` (`http.get/post`), resolvers.
- **note:** decorators + DI — heavier parse; AST over `.ts`, component templates may be inline or `.html`.

### [x] `remix` — Remix / React Router 7 (framework mode) ✅ shipped (`remix.ts`)
- **detect:** `@remix-run/react|node|dev` or `@react-router/dev` in deps + an `app/routes/` (or `src/app/routes/`) dir.
- **screen:** file-based flat routes → route, parsed with the shared React JSX parser. `.` = path separator (`blog.$slug.tsx` → `/blog/:slug`), `_index` collapses to parent, leading-underscore segment is a pathless layout (dropped: `_auth.login.tsx` → `/login`), `$param` → `:param`, bare `$` → splat; folder form `routes/x/route.tsx` supported; `root` excluded. id = route, entry = "/".
- **nav:** `<Link to>`, `useNavigate()` (shared parser). **calls:** `fetch`, query hooks.
- **detection guard:** Remix's `app/` dir collides with Next app-router, and RR7 shares the `react-router` dep — so remix is registered before react-router and the Next adapters bow out via `isRemixApp()`.
- **fixture:** `examples/remix-mini` (5 routes incl. `_index`, `blog._index`, `blog.$slug`, pathless `_auth.login`, excluded `root`).
- **follow-up:** `loader`/`action` data deps; `redirect()` in loaders; nested layout `<Outlet>` containment.

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

### [x] `compose` — Android Jetpack Compose (Kotlin) ✅ shipped (`compose.ts`)
- **detect:** any `.kt` importing `androidx.compose` / `androidx.navigation.compose`.
- **screen:** `composable("route") { Foo(...) }` NavHost destinations — id = the route string (so `navigate("route")` resolves). Pass 1 indexes every `@Composable fun` → its file (whole-source match: `@Composable` and `fun` sit on separate lines); pass 2 maps each destination's first composable call to that file. Entry = NavHost `startDestination`.
- **nav:** `navController.navigate("route")`.
- **calls:** `URL("…")` / `client.get|post|…("url")` / Retrofit/Ktor/OkHttp client construction.
- **features:** Button family, TextField family, Checkbox/Switch/RadioButton/Slider, Lazy* lists.
- **parse:** Kotlin — zero-dependency regex line-scan (SwiftUI's style), no tree-sitter. Pairs with `swiftui` as the native-mobile set.
- **detection guard:** Gradle's `app/` module dir collides with Next app-router, so the Next adapters bow out for Android via `isAndroidApp()` (build.gradle[.kts]/settings.gradle[.kts] — Android has no package.json).
- **fixture:** `examples/compose-mini` (NavHost startDestination + 3 destinations across files).
- **follow-up:** typed nav routes (Kotlin Serialization); nested `navigation("graph")`; `ViewModel` repository calls as data deps; deep links.

### [x] `uikit` — iOS UIKit (Swift, programmatic) ✅ shipped (`uikit.ts`)
- **detect:** a `.swift` file `import UIKit` + a `class X: UIViewController` (or UITableView/Collection/Navigation/TabBar/Page/SplitViewController). Registered after `swiftui`, so a SwiftUI app that also imports UIKit is claimed by swiftui first; only pure-UIKit apps fall here.
- **screen:** each VC subclass (prefer the one matching the filename). id = class name.
- **nav:** `pushViewController` / `present` / `show` / `instantiateViewController` → target VC. Resolves an inline `XxxViewController(` **and** a bound `let vc = XxxViewController(); push(vc)` (tracks `let/var` → VC bindings in the function).
- **calls:** `URL(string:)` / `"https://…"` / `URLRequest(url:)`. **features:** UIButton, UITextField family, UISwitch/Slider/Stepper/SegmentedControl/Picker/DatePicker, UITableView/UICollectionView.
- **parse:** zero-dependency line scan (swiftui's style). Storyboard `.storyboard` XML segues not parsed yet — programmatic nav covered.
- **fixture:** `examples/uikit-mini` (3 VCs: push via bound var, present inline, show via bound var — all resolved).
- **follow-up:** storyboard segues; `instantiateViewController(withIdentifier:)` string ids; Alamofire calls.

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

### [x] `static-html` — plain multi-page HTML sites ✅ shipped (`static-html.ts`)
- **detect:** any `.html`/`.htm` file (skipping node_modules/dist/build/out/coverage). Registered **last**, so it only runs when no framework matched — "a folder of pages" still yields a map.
- **screen:** each `.html` → page; `index.html` collapses to its dir, `.html` stripped. Title from the page's `<title>`. id = route, entry = "/".
- **nav:** `<a href>` — relative links are resolved against the page's own route to an absolute id, so cross-page transitions match (`../index.html` → `/`, `docs/intro.html` → `/docs/intro`); external/mailto/tel pass through.
- **calls:** `<form action>` (POST) + `<script>` `fetch()`. **features:** `<button>`, `<input|textarea|select>`, `<form>`.
- **fixture:** `examples/static-mini` (4 pages incl. nested `docs/`, relative + external links, form action, fetch).
- **note:** lowest-fidelity fallback; zero-dependency regex scan.

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

✅ Done: `next-pages` + `react-router` + `remix` (React/web), `vue`/`nuxt` (Vue), `svelte` (SvelteKit), `astro` (Astro), `react-native` (expo-router + react-navigation), `swiftui` + `uikit` (iOS) + `compose` (Android) — the native set, `static-html` (plain HTML fallback).

Remaining:
1. `angular` — more web; reuses ts-morph but needs decorator/DI handling.
2. `flutter` — round out native; Dart needs a regex line-scan like swiftui/uikit/compose.
3. Tier 3 server-rendered (`django`/`flask`, `rails`) — breadth.
