import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "../mcp/server.js";

/**
 * Alkahest MCP 서버를 stdio 로 띄운다 (ALKAHEST.md §7, 에이전트 모드).
 * 에이전트 MCP 설정에서 `command: "alkahest", args: ["mcp"]` 로 연결.
 * stdout 은 JSON-RPC 전용이므로 절대 console.log 하지 않는다.
 */
export async function mcp(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  // 연결 후 프로세스는 stdio 가 살아있는 동안 유지된다.
}
