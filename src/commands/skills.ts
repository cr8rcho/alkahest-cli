import { pullSkills, type SkillDoc } from "../core/tasks.js";

/**
 * CLI surface of the user's SKILLS (cloud ADR-068 personal + ADR-070 team): named markdown
 * instruction documents an agent follows when writing for the user. They are managed on the
 * web (/home/skills, /home/team-skills) and read here — `skills list` prints the names with
 * their scope and defaults, `skills show <name>` prints one body (pipe it into a prompt).
 * Same data the MCP `skills` tool returns (skills-pull); nothing is stored locally.
 */

const die = (msg: string): void => {
  console.error(`[alkahest] ${msg}`);
  process.exitCode = 1;
};

const failMessage = (code: string | undefined, message: string | undefined, action: string): string => {
  const known: Record<string, string> = {
    invalid_token: "✗ Token invalid or revoked. Run 'alkahest login' again.",
    no_token: `${message ?? "No API token."}\n  Run 'alkahest login' first — skills need an account token, not a project.`,
  };
  return known[code ?? ""] ?? `${action} failed: ${message}`;
};

/** "name  (team: ws-slug)  [default: task_note]" — the per-row summary both commands share. */
const describe = (s: SkillDoc): string => {
  const scope = s.scope === "workspace" ? `  (team: ${s.workspace ?? "?"})` : "";
  const defaults = s.default_for?.length ? `  [default: ${s.default_for.join(", ")}]` : "";
  return `${s.name}${scope}${defaults}`;
};

export interface SkillsListOptions { api?: string; path?: string }

export async function skillsList(options: SkillsListOptions): Promise<void> {
  const res = await pullSkills(options.path || ".", { api: options.api });
  if (!res.ok || !res.skills) return die(failMessage(res.code, res.message, "skills list"));
  if (!res.skills.length) {
    return console.log("[alkahest] no skills yet — write one on the web (/home/skills) or with the MCP add_skill tool.");
  }
  console.log(`[alkahest] ${res.skills.length} skill(s)`);
  for (const s of res.skills) console.log(`  ${describe(s)}`);
}

export interface SkillsShowOptions { api?: string; path?: string; team?: string }

/**
 * Print one skill's markdown body. A personal and a team skill may share a name (the web
 * allows it); personal wins unless `--team <workspace>` picks the team copy.
 */
export async function skillsShow(name: string, options: SkillsShowOptions): Promise<void> {
  const res = await pullSkills(options.path || ".", { api: options.api });
  if (!res.ok || !res.skills) return die(failMessage(res.code, res.message, "skills show"));
  const wanted = name.trim().toLowerCase();
  const matches = res.skills.filter((s) => s.name.toLowerCase() === wanted);
  const pick = options.team
    ? matches.find((s) => s.scope === "workspace" && s.workspace === options.team)
    : matches.find((s) => s.scope !== "workspace") ?? matches[0];
  if (!pick) {
    const hint = matches.length && options.team
      ? `No team copy of '${name}' in workspace '${options.team}' — it exists as: ${matches.map(describe).join("; ")}.`
      : `No skill named '${name}'. 'alkahest skills list' shows yours.`;
    return die(`✗ ${hint}`);
  }
  if (matches.length > 1 && !options.team) {
    console.error(`[alkahest] '${name}' exists in several scopes — showing the personal one. Pass --team <workspace> for a team copy.`);
  }
  console.log(pick.body ?? "");
}
