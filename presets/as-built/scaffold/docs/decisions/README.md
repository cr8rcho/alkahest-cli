# Decisions (ADR)

This folder collects **Architecture Decision Records** — the why / alternatives /
trade-offs of decisions, frozen at decision time. Writing instructions and the template
live in the `adr` account skill (read it via the alkahest MCP `skills` tool).

Quick rules:

- `NNN-kebab-title.md`, zero-padded, sequential, never renumbered.
- Append-only: a changed decision gets a NEW ADR with `Supersedes:`; the old one keeps its
  body and gets `Status: Superseded by …`.
- Start the practice with **ADR-001 — architecture snapshot** of the current code.
