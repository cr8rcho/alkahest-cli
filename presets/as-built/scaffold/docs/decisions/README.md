# Decisions (ADR)

This folder collects **Architecture Decision Records** — the why / alternatives /
trade-offs of decisions, frozen at decision time. Writing instructions and the template
live in the `adr` account skill (read it via the alkahest MCP `skills` tool).

Quick rules:

- `NNN-kebab-title.md`, zero-padded, sequential, never renumbered.
- Append-only: a changed decision gets a NEW ADR with `Supersedes:`; the old one keeps its
  body and gets `Status: Superseded by …`.
- Start the practice with **ADR-001 — architecture snapshot** of the current code.

## Tag vocabulary

Every ADR opens with `tags:` frontmatter, and **this table is the vocabulary** — pick from
it; extend it deliberately (add the row in the same commit as the ADR that needs it). On the
hosted `adr` note map each tag becomes a hub node, so the vocabulary's shape IS the map's
shape: one **surface** tag per ADR (the product/code area it touches) plus at most two
**arc** tags (a storyline several ADRs share), and keep each tag attached to roughly 3–12
ADRs. The first documentation pass seeds the surface rows from the codebase's actual areas.

| Tag | Kind | Meaning |
|---|---|---|
