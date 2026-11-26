import { homedir } from "node:os";
import { sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { loadCredentials } from "../core/credentials.js";
import type { ProjectInfo } from "../core/listProjects.js";
import {
  linkRoot, matchProject, onPath, readMcpJson, registerUserMcp, removeMcpEnv, shadowedMcpEnv,
  userMcpState, writeLink,
} from "../core/link.js";
import { localSlug } from "../core/project.js";
import { authStatus } from "../core/status.js";

/**
 * `alkahest setup [project]` — make this folder ready for an agent, in one idempotent run:
 *   1. signed in?           (stops here if not — the user runs `alkahest login` themselves)
 *   2. bind the folder       (.alkahest/project.json — same file publish writes)
 *   3. register the MCP server at Claude Code's USER scope, once per machine
 *   4. drop .mcp.json env lines the first two made dead (ALKAHEST_TOKEN / ALKAHEST_PROJECT)
 *
 * `alkahest link [project]` is steps 1, 2 and 4 — rebinding a folder on a machine that is
 * already set up. Both are written to be run BY an agent from a pasted prompt (the web's
 * "Connect a folder" dialog): plain lines, a non-zero exit with the next action when it stops,
 * and no prompt it can't answer without --yes.
 */

export interface SetupOptions {
  path?: string;
  api?: string;
  /** Answer yes to every question (rebind, .mcp.json cleanup). */
  yes?: boolean;
  /** commander's --no-mcp → false. */
  mcp?: boolean;
}

/** ~/… for display — the full scratch/temp paths agents run in are long. */
const tilde = (p: string) => (p === homedir() || p.startsWith(homedir() + sep) ? "~" + p.slice(homedir().length) : p);

const isTTY = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function confirm(question: string, yes: boolean | undefined, dflt: boolean): Promise<boolean> {
  if (yes) return true;
  if (!isTTY()) return dflt;
  const a = await ask(`${question} ${dflt ? "[Y/n]" : "[y/N]"} `);
  if (!a) return dflt;
  return /^y(es)?$/i.test(a);
}

function label(p: ProjectInfo): string {
  const ws = p.workspace ? p.workspace.name || p.workspace.slug : "";
  const name = p.name && p.name !== p.slug ? `  ${p.name}` : "";
  return `${p.slug}${name}${ws ? `  (${ws})` : ""}`;
}

function printList(projects: ProjectInfo[]): void {
  for (const p of projects) console.log(`    ${label(p)}`);
}

/** Pick from a list on a terminal; null when there's no terminal or the answer isn't a choice. */
async function pick(projects: ProjectInfo[]): Promise<ProjectInfo | null> {
  if (!isTTY() || !projects.length) return null;
  console.log("  Which project is this folder for?");
  projects.forEach((p, i) => console.log(`    ${String(i + 1).padStart(2)}. ${label(p)}`));
  const a = await ask("  Number or slug: ");
  const n = Number(a);
  if (Number.isInteger(n) && n >= 1 && n <= projects.length) return projects[n - 1];
  return matchProject(a, projects).project ?? null;
}

const LOGIN_HELP = [
  "  Create a token: https://www.alkahest.app/home/tokens",
  "  Then run:       alkahest login --token alk_…",
  "  and run this command again.",
];

export async function setup(input: string | undefined, options: SetupOptions = {}, mode: "setup" | "link" = "setup"): Promise<void> {
  const root = linkRoot(options.path ?? ".");
  const fail = (lines: string[]) => {
    console.log(lines.join("\n"));
    process.exitCode = 1;
  };

  // 1. Signed in? The project list is also what we verify the slug against.
  const auth = await authStatus({ api: options.api });
  if (auth.state === "anonymous" || auth.state === "invalid" || auth.state === "expired") {
    const head = auth.state === "anonymous" ? "not signed in" : auth.state === "expired" ? "token expired" : "token invalid or revoked";
    return fail([`✗ ${head}`, ...LOGIN_HELP]);
  }
  if (auth.state === "scoped") {
    return fail(["✗ this token is scoped (widget/capture) — setup needs a full-access token", ...LOGIN_HELP]);
  }
  if (auth.state === "unreachable") {
    return fail([`✗ could not reach the API (${auth.message ?? "network error"})`, "  Check your connection and run this command again."]);
  }
  const projects = auth.projects ?? [];
  console.log(`✓ signed in${auth.workspaces?.length ? ` — ${auth.workspaces.map((w) => w.name || w.slug).join(", ")}` : ""}`);

  // 2. Which project. Named → the folder's current binding → the repo's .mcp.json env (the
  //    config this replaces) → ask.
  const current = localSlug(root);
  const fromMcp = readMcpJson(root)?.env.ALKAHEST_PROJECT;
  const wanted = input?.trim() || current || fromMcp; // an existing link wins at runtime, so it wins here too
  let project: ProjectInfo | undefined;
  if (wanted) {
    const m = matchProject(wanted, projects);
    if (m.project) {
      project = m.project;
      if (!m.exact) console.log(`  "${wanted}" → ${project.slug}`);
    } else if (m.candidates.length) {
      project = (await pick(m.candidates)) ?? undefined;
      if (!project) return fail([`✗ "${wanted}" matches several projects — pass the slug:`, ...m.candidates.map((p) => `    ${label(p)}`)]);
    } else {
      return fail([
        `✗ no project "${wanted}" on this account`,
        ...(projects.length ? ["  Projects you can reach:"] : ["  This account has no projects yet — create one at https://www.alkahest.app/home/projects"]),
      ].concat(projects.length ? projects.map((p) => `    ${label(p)}`) : []));
    }
  } else {
    project = (await pick(projects)) ?? undefined;
    if (!project) {
      if (!projects.length) {
        return fail(["✗ this account has no projects yet", "  Create one at https://www.alkahest.app/home/projects, or run `alkahest publish` in a code repo."]);
      }
      console.log("✗ which project? Run again with one of these:");
      printList(projects);
      console.log(`  e.g. alkahest ${mode} ${projects[0].slug}`);
      process.exitCode = 1;
      return;
    }
  }

  if (current && current !== project.slug) {
    const ok = await confirm(`  This folder is linked to ${current}. Switch it to ${project.slug}?`, options.yes, false);
    if (!ok) {
      return fail([`✗ left linked to ${current}`, `  Pass --yes to switch it to ${project.slug}.`]);
    }
  }
  const link = writeLink(root, project.slug);
  console.log(`✓ this folder → ${project.slug}${link.changed ? "" : " (already linked)"}`);
  console.log(`  ${tilde(root)}/.alkahest/project.json`);
  if (project.capability === "viewer") {
    console.log("  Note: you're a viewer on this project — your agent can read it but not write issues or notes.");
  }

  // 3. MCP server, once per machine.
  let restart = false;
  let state: ReturnType<typeof userMcpState> | undefined;
  if (mode === "setup" && options.mcp !== false) {
    state = userMcpState();
    if (state === "registered") {
      console.log('✓ MCP server "alkahest" already registered (Claude Code, user scope)');
    } else if (state === "no_claude") {
      console.log("· Claude Code not found — register the server in your client yourself:");
      console.log('    command "alkahest", args ["mcp"]  (no env needed — it reads your login and this folder)');
    } else if (!onPath("alkahest")) {
      console.log("· skipped MCP registration — the `alkahest` command isn't on PATH (running via npx?)");
      console.log("    npm install -g @cr8rcho/alkahest   then run this command again");
    } else {
      const r = registerUserMcp();
      if (r.ok) {
        console.log('✓ registered MCP server "alkahest" (Claude Code, user scope)');
        restart = true;
      } else {
        console.log(`✗ could not register the MCP server: ${r.message || "claude mcp add failed"}`);
        console.log("    claude mcp add -s user alkahest -- alkahest mcp");
        process.exitCode = 1;
      }
    }
  }

  // 4. .mcp.json lines that now do nothing.
  const dead = shadowedMcpEnv(root);
  if (dead.length) {
    const ok = await confirm(`  .mcp.json sets ${dead.join(" and ")}, which ${dead.length > 1 ? "are" : "is"} no longer used. Remove?`, options.yes, false);
    if (ok) {
      const removed = removeMcpEnv(root, dead);
      console.log(`✓ removed ${removed.join(", ")} from .mcp.json`);
    } else {
      console.log(`· .mcp.json still sets ${dead.join(", ")} (unused — your login and this folder's link win). --yes removes ${dead.length > 1 ? "them" : "it"}.`);
    }
  }
  if (mode === "setup" && readMcpJson(root) && options.mcp !== false) {
    // Both scopes register the same command; the project entry is now just redundant (and keeps
    // Claude Code's per-repo approval prompt alive). Said whether registered now or before.
    if (state === "registered" || restart) {
      console.log('· this repo\'s .mcp.json also registers "alkahest" — you can delete that entry; the user-scope one covers every repo.');
    }
  }

  console.log("");
  if (restart) console.log("! Restart your Claude Code session to load the alkahest tools.");
  const name = project.name || project.slug;
  console.log(`Ready. Your agent now works on ${name} from this folder.`);
  if (!loadCredentials().token && process.env.ALKAHEST_TOKEN) {
    console.log("  (Signed in through ALKAHEST_TOKEN only — `alkahest login --token …` saves it for every agent on this machine.)");
  }
}

export async function link(input: string | undefined, options: SetupOptions = {}): Promise<void> {
  return setup(input, options, "link");
}
