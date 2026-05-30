# Alkahest

**English** · [한국어](./README.ko.md)

> Reverse-engineer the product from the code, so people can make product decisions.

Alkahest is a CLI that **statically analyzes** a UI codebase and builds a **Product Map**.
It extracts screens as nodes, and the navigation between screens plus the API/data calls each screen makes as edges — then shows it in an interactive dashboard and helps you write PRDs and requirements.

Platforms are **pluggable via adapters** — currently **Next.js (app-router)** and **SwiftUI**. The data model is platform-agnostic, so other frameworks just need a new adapter.

Where the references (graphify, codegraph, Understand-Anything) build *code-symbol* graphs, Alkahest aims one level up — **screen-level product understanding** — for a target audience of **PMs / product folks**.

```
Screen ──navigate (Link / router.push / redirect)──▶ Screen
   │
   └──call (fetch / useQuery / server action)──▶ Resource (API endpoint / data)
```

## Two-layer graph

- **Nodes**: `Screen` (route/page) · `Resource` (the API/data a screen calls)
- **Edges**: `Transition` (screen → screen) · `Call` (screen → resource)
- When several screens call the same resource they share one node — so the graph reveals "which screens use `/api/orders` together" (data dependencies & change impact).

## Two run modes — does it need an LLM key?

The core output `map.json` is **deterministic and needs no key at all.** The LLM is only used in the *optional layer* (summaries, PRDs), and who that LLM is decides the mode.

| | **Agent mode** (called as a skill/tool) | **Standalone mode** (a person runs it) |
|---|---|---|
| Who reasons | The calling agent (Claude Code / Codex / Cursor) is already an LLM | Alkahest calls the API itself |
| `ANTHROPIC_API_KEY` | **Not needed** | Required |
| Entry point | `alkahest mcp` (MCP server) | `scan --summarize` / `prd` |

## Install

> npm publish is planned. For now, build from source.

```bash
git clone https://github.com/cr8rcho/alkahest.git
cd alkahest
npm install
npm run build
npm link          # link the 'alkahest' command globally (optional)
```

After publish: `npm i -g alkahest` or `npx alkahest …`

## Usage

Run it from the root of the project you want to analyze; outputs land in that project's `.alkahest/` folder.

```bash
alkahest scan              # analyze → .alkahest/map.json + index.html (incremental by default)
alkahest scan --full       # ignore the baseline and rescan everything
alkahest view              # open the dashboard via a local server (two-layer graph)
alkahest scan --summarize  # fill in per-screen LLM summaries (needs ANTHROPIC_API_KEY)
alkahest prd checkout      # generate a screen's PRD/requirements markdown → .alkahest/prd/checkout.md
alkahest hook install      # run scan automatically on commit/merge (diff-driven refresh)
alkahest mcp               # run the MCP server (agents query the product map; no key)
```

### Dashboard interactions

- **Force-directed layout** — nodes settle naturally by their connections. A fixed seed keeps the layout the same every time.
- **Start point** is marked with a `▶` prefix on its label (app entry point / root route).
- **Hover** a node to highlight its connected edges and neighbors by color (preview).
- **Click** a screen to pin it — the right panel shows its features, transitions, and calls.
- **Drag** a node to move it (connected neighbors follow), **wheel/pinch** to zoom, drag empty space to pan.
- Top right: **🌗** light/dark toggle, **⤢ Fit** to frame the whole graph.
- Edges: solid = navigate, short dashes = contains, long dashes = call.

### Agent (MCP) integration

Add it to your agent's MCP config; the agent queries the product map with the `scan` / `overview` / `get_screen` / `who_calls` tools and **writes the summaries/PRDs itself** (no separate key needed).

```json
{
  "mcpServers": {
    "alkahest": { "command": "alkahest", "args": ["mcp"] }
  }
}
```

## Output — `.alkahest/`

```
.alkahest/
├─ map.json       # the canonical ProductMap (source of every output)
├─ index.html     # self-contained interactive dashboard (no external deps / network)
└─ prd/<screen>.md
```

`index.html` inlines both the data and the render code, so it's a **self-contained file** you can open in a browser without Alkahest or a server. Add `.alkahest/` to your `.gitignore`.

## Incremental & auto-refresh

`scan` is **incremental** by default — it compares file hashes against `map.json`, re-parses only the changed screens, and preserves everything else (including LLM summaries). Run `alkahest hook install` to wire a git hook so the map refreshes automatically on every commit/merge.

## Scope & limitations

Current adapters:

| Adapter | Screen | Navigate | Call |
|---|---|---|---|
| **Next.js app-router** | `app/**/page.tsx` | `<Link>` · `router.push` · `redirect` | `fetch` · query hooks |
| **SwiftUI** | `struct X: View` | `NavigationLink` · `.sheet` · `.fullScreenCover` · `navigationDestination` | `URL(string:)` · `URLRequest` |

- **Limitations**: parsing is per file/view — features/calls inside imported child components aren't traced yet. Dynamic targets (`router.push(variable)`, a `useQuery` hook's URL, etc.) are marked "unresolved".
- More adapters (pages router, React Router, Jetpack Compose, …) and runtime screenshots are planned as needed — a new platform is just one adapter under `src/core/adapters/`.

## Development

```bash
npm install
npm run build
node dist/cli.js scan examples/sample-next   # try it on the bundled fixture
npm run typecheck
```

The single source of truth for the design is [`ALKAHEST.md`](./ALKAHEST.md).

## License

MIT
