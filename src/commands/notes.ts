import { createNote } from "../core/notes.js";

/**
 * CLI surface of the hosted Note Map (cloud ADR-017). `notes add` creates a note (a node of the
 * mindmap) through the notes-post edge function via src/core/notes.ts; nothing is stored locally.
 * There's no pull/update yet — the interactive canvas on the hosted viewer is where notes are read,
 * arranged, and connected.
 */

const die = (msg: string): void => {
  console.error(`[alkahest] ${msg}`);
  process.exitCode = 1;
};

const failMessage = (code: string | undefined, message: string | undefined, action: string): string => {
  const known: Record<string, string> = {
    invalid_token: "✗ Token invalid or revoked. Run 'alkahest login' again.",
    forbidden: "✗ Only the project owner or a collaborator can do this.",
    not_found: `✗ ${message ?? "Not found."}`,
    no_slug: message ?? "No published map for this project yet.",
    ambiguous_map: `✗ ${message ?? "This project has several note maps."}\n  See them with 'alkahest maps list', or make a new one with 'alkahest maps create <slug> --type note'.`,
  };
  return known[code ?? ""] ?? `${action} failed: ${message}`;
};

export interface NotesAddOptions {
  api?: string; slug?: string; path?: string; map?: string;
  body?: string; parent?: string;
}

export async function notesAdd(title: string, options: NotesAddOptions): Promise<void> {
  const res = await createNote(options.path || ".", {
    api: options.api, slug: options.slug, mapSlug: options.map,
    title, body: options.body, parent_id: options.parent,
  });
  if (!res.ok || !res.note) return die(failMessage(res.code, res.message, "notes add"));
  console.log(`[alkahest] created note "${res.note.title}" — id ${res.note.id}`);
}
