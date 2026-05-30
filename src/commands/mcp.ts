import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "../mcp/server.js";

/**
 * Run the Alkahest MCP server over stdio (ALKAHEST.md §7, agent mode).
 * Connect from an agent's MCP config via `command: "alkahest", args: ["mcp"]`.
 * stdout is reserved for JSON-RPC, so never console.log here.
 */
export async function mcp(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  // After connecting, the process stays alive while stdio is open.
}
