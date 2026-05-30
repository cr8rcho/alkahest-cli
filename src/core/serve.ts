import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { OUTPUT_DIR } from "./emit.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

/**
 * `<projectRoot>/.alkahest` 를 로컬 정적 서버로 띄우고 브라우저를 연다.
 * 서버가 이벤트 루프를 유지하므로 프로세스는 Ctrl+C 까지 살아있다.
 */
export async function serveDashboard(projectRoot: string): Promise<void> {
  const root = resolve(projectRoot, OUTPUT_DIR);
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const filePath = resolve(root, "." + (urlPath === "/" ? "/index.html" : urlPath));
      if (filePath !== root && !filePath.startsWith(root + "/")) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });

  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}/`;
  console.log(`[alkahest] 대시보드: ${url}  (Ctrl+C 로 종료)`);
  openBrowser(url);
}

function openBrowser(url: string): void {
  const isWin = platform() === "win32";
  const cmd = platform() === "darwin" ? "open" : isWin ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: isWin }).unref();
  } catch {
    /* 브라우저 자동 오픈 실패는 무시 — URL 은 위에 출력됨 */
  }
}
