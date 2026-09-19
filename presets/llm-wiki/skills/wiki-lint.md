# alkahest/wiki-lint — keep the wiki healthy

A periodic health check of the wiki: find what has drifted, fix what is mechanical, propose
what needs the user, and leave a report the next lint can read. Read `alkahest/wiki` first
for the layout and the tools.

## When to run

Run a lint when the user asks ("lint the wiki", "위키 정리해줘", "health check"), and
**offer one yourself** when either is true:
- roughly ten sources have been ingested since the last lint, or
- the newest note under `outputs/lint` is older than two weeks (or there is none).

(A real schedule — a weekly agent routine — is the user's choice; this skill only makes
the agent raise its hand.)

## Start with the Trash

`notes` hides trashed pages, but the last lint may have sent pages there that the user
has not reviewed. Before doing anything new, read the previous `outputs/lint` report's
"Sent to the Trash" section: anything still inside its 30-day window is a pending
decision — mention it, don't pile more on top without asking.

## Checks

Read the map with `notes` (excerpts; `full_bodies` only when the wiki is small), then:

| Check | What to look for | Mechanical fix |
|---|---|---|
| **Orphans** | pages with no `[[…]]` backlinks and none outgoing (`get_note` shows both) | connect: add a `## Related` reference from the closest hub page, or into the orphan |
| **Duplicates** | two pages on one topic (`notes q=` around suspicious titles) | merge into the better page, then trash the other |
| **Empty / stub pages** | title only, or a body under a couple of lines with no references | fill from the source pages, or trash |
| **Contradictions** | pages that disagree; a source page newer than the claim it contradicts | **write the difference into the page**, prefer the newer claim — never delete the older claim |
| **Stale claims** | dated statements superseded by later sources | same as above; add "as of <date>" |
| **Missing pages** | an entity or concept referenced as `[[…]]` from several pages but with no page of its own (unresolved references stay literal — they are the tell) | propose; create only when the sources on the map already support a page |
| **Missing cross-references** | pages that obviously belong together but don't cite each other | add the references |
| **Data gaps** | questions the wiki cannot answer that a web search or a new source could | list as follow-up research in the report |

## Delete policy — three rules

Deleting is `update_note` with `delete: true` and a **`reason`**. It is a soft delete: the
page goes to the project Trash, restorable for 30 days from the web Trash view or with
`update_note restore: true`, and only then is purged. The activity journal shows every
deletion with its reason. That safety net is why lint may delete at all — and it is the
whole safety net, so:

1. **The reason says *why it should go*, in one line the user can judge without opening
   the page** — `duplicate of [[X]], content merged`, `empty stub, topic covered by [[Y]]`,
   `superseded by [[Z]] — lint 2026-09-19`. Never `cleanup`.
2. **`raw/` is never deleted or edited.** It is the source of truth the wiki is compiled
   from; a raw page's only lint outcome is "unlinked — no source page yet".
3. **Contradictions and stale claims are written, not deleted.** "We used to think X" is
   knowledge. Orphans are connected, not deleted.

On a shared wiki, a page created by someone else is **proposed, not trashed** — list it in
the report with the suggested action.

## The report

Write `outputs/lint/<YYYY-MM-DD> wiki lint` (`props.tags: ["lint"]`) with:

- **Fixed** — what you connected, merged, filled, annotated (page links)
- **Sent to the Trash** — each page with its reason, and one line on how to restore
- **Proposed** — what needs the user: pages to create, contradictions to resolve, other
  people's pages that look retirable
- **Follow-up research** — the questions the wiki cannot answer yet
- **Counts** — pages / orphans / trashed, so the next lint sees the trend

Tell the user the report's link and the two or three items that most need their eye.
