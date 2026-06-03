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

## No API key — the agent reasons

The core output `map.json` is **deterministic and needs no LLM key.** Alkahest never calls an LLM itself. When you want narrative output (summaries, PRDs, requirements), your **agent** does the reasoning: connect Alkahest as an MCP server, and Claude Code / Codex / Cursor query the product map and write the prose themselves — no key, no SDK.

```
You ── "write a PRD for the checkout screen" ──▶ Agent (Claude Code / Codex)
                                                    │  get_screen / who_calls (MCP)
                                                    ▼
                                                 Alkahest  →  map.json (deterministic, no key)
```

## Install

```bash
npm i -g @cr8rcho/alkahest      # the command is `alkahest`
# or run without installing:  npx @cr8rcho/alkahest <command>
```

From source (contributors):

```bash
git clone https://github.com/cr8rcho/alkahest.git
cd alkahest && npm install && npm run build && npm link
```

## Quickstart (Claude Code)

The full flow for a Claude Code user, from zero to a graph + PRDs in the dashboard:

```bash
# 1. Install alkahest:  npm i -g @cr8rcho/alkahest   (or build from source above + `npm link`)

# 2. In your project root, build the product map
cd ~/my-next-app
alkahest scan                 # → .alkahest/map.json + index.html

# 3. Register the MCP server with Claude Code (project scope = shared via .mcp.json)
claude mcp add alkahest -s project -- alkahest mcp
#   verify it's connected:  run `claude` then `/mcp`  → "alkahest" should be listed
```

Now just **talk to Claude Code** — it uses the alkahest MCP tools for you:

```
You:  "Give me an overview of this product's screens."
        → Claude calls overview → summarizes the structure.

You:  "Write a PRD for the checkout screen and the cart screen."
        → Claude calls get_screen / who_calls to read the structure,
          writes each PRD, and calls set_prd to save it into map.json.

You:  "alkahest view"   (or run it in a terminal)
        → opens the dashboard. Click a screen node → the right panel
          shows its Summary + PRD that Claude just wrote.
```

That's it: **scan → register MCP → ask Claude → `view`.** No API key — Claude does the writing, alkahest stores it in `map.json` and renders it in the self-contained dashboard.

## Usage

Run it from the root of the project you want to analyze; outputs land in that project's `.alkahest/` folder.

```bash
alkahest scan          # analyze → .alkahest/map.json + index.html (incremental by default)
alkahest scan --full   # ignore the baseline and rescan everything
alkahest view          # open the dashboard via a local server (two-layer graph)
alkahest hook install  # run scan automatically on commit/merge (diff-driven refresh)
alkahest mcp           # run the MCP server (agents query the product map; no key)
alkahest login         # save your publish token (Account → Create token on alkahest.app)
alkahest publish       # upload the map to the hosted viewer → shareable link
alkahest update        # update to the latest GitHub release (--check to only check)
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

Register the MCP server once, then the agent reads the map and **writes summaries / PRDs / requirements itself** — no key needed.

```bash
# Claude Code (recommended): project scope writes a shared .mcp.json
claude mcp add alkahest -s project -- alkahest mcp
```

Or add it to any MCP-capable agent's config directly:

```json
{
  "mcpServers": {
    "alkahest": { "command": "alkahest", "args": ["mcp"] }
  }
}
```

**Tools exposed:**

| Tool | What it does |
|---|---|
| `scan` | (re)build the product map for the project |
| `overview` | list all screens & resources at a glance |
| `get_screen` | one screen's full structure (features, navigation, calls, source) |
| `who_calls` | which screens call a given API/resource (impact analysis) |
| `set_summary` | save a one-line summary onto a screen → shown in the dashboard panel |
| `set_prd` | save a PRD/requirements markdown onto a screen → rendered in the panel |
| `publish` | upload the map to the hosted viewer → shareable link (needs a token, see below) |
| `check_version` | report installed vs latest GitHub release (so the agent can suggest `alkahest update`) |

The agent reads with `get_screen` / `who_calls` and writes back with `set_summary` / `set_prd`; both write into `map.json` and re-render `index.html`, so the dashboard always reflects the latest.

**Publishing from the agent (optional).** `scan` / read / write-back need no key. `publish` does — it uploads the map to your account on the hosted viewer. Get a token at **alkahest.app → Account → Create token**, then put it in the MCP config so the server can authenticate:

```bash
claude mcp add alkahest -s project \
  -e ALKAHEST_TOKEN=alk_xxxxx \
  -e ALKAHEST_API_URL=https://<ref>.supabase.co/functions/v1 \
  -- alkahest mcp
```

```json
{
  "mcpServers": {
    "alkahest": {
      "command": "alkahest",
      "args": ["mcp"],
      "env": {
        "ALKAHEST_TOKEN": "alk_xxxxx",
        "ALKAHEST_API_URL": "https://<ref>.supabase.co/functions/v1"
      }
    }
  }
}
```

If you've already run `alkahest login`, the saved credentials are used as a fallback — no env needed. Then just ask the agent to *"publish this"* and it returns the link.

## Output — `.alkahest/`

```
.alkahest/
├─ map.json       # the canonical ProductMap (source of every output)
└─ index.html     # self-contained interactive dashboard (no external deps / network)
```

`index.html` inlines both the data and the render code, so it's a **self-contained file** you can open in a browser without Alkahest or a server. Add `.alkahest/` to your `.gitignore`.

## Incremental & auto-refresh

`scan` is **incremental** by default — it compares file hashes against `map.json`, re-parses only the changed screens, and preserves everything else. Run `alkahest hook install` to wire a git hook so the map refreshes automatically on every commit/merge.

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
