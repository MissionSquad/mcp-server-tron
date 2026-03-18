import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";
import { MCP_PROTOCOL_VERSION } from "../../src/server/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "../../src/index.ts");

type PendingResponse = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
};

function startStdioServer() {
  const serverProcess = spawn(process.execPath, ["--import", "tsx", serverPath, "--readonly"], {
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pendingResponses = new Map<number, PendingResponse>();
  const badStdoutLines: string[] = [];
  let buffer = "";
  let processExitError: Error | null = null;

  const settleResponse = (id: number, value: unknown) => {
    const pending = pendingResponses.get(id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    pendingResponses.delete(id);
    pending.resolve(value);
  };

  const onStdoutData = (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed) as { id?: number };
        if (typeof parsed.id === "number") {
          settleResponse(parsed.id, parsed);
        }
      } catch (_error) {
        badStdoutLines.push(trimmed);
      }
    }
  };

  serverProcess.stdout.on("data", onStdoutData);
  serverProcess.stderr.on("data", () => {
    // Drain stderr so the child never blocks on backpressure.
  });
  serverProcess.once("error", (error) => {
    processExitError = error instanceof Error ? error : new Error(String(error));
    for (const pending of pendingResponses.values()) {
      clearTimeout(pending.timer);
      pending.reject(processExitError);
    }
    pendingResponses.clear();
  });
  serverProcess.once("exit", (code, signal) => {
    if (code === 0) {
      return;
    }

    processExitError = new Error(
      `stdio server exited unexpectedly: code=${code}, signal=${signal ?? "null"}`,
    );
    for (const pending of pendingResponses.values()) {
      clearTimeout(pending.timer);
      pending.reject(processExitError);
    }
    pendingResponses.clear();
  });

  const send = (message: Record<string, unknown>) => {
    serverProcess.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const waitForResponse = (id: number, timeoutMs = 5000) =>
    new Promise<unknown>((resolve, reject) => {
      if (processExitError) {
        reject(processExitError);
        return;
      }

      const timer = setTimeout(() => {
        pendingResponses.delete(id);
        reject(new Error(`Timeout waiting for response to ${id}`));
      }, timeoutMs);

      pendingResponses.set(id, { resolve, reject, timer });
    });

  return {
    badStdoutLines,
    send,
    serverProcess,
    waitForResponse,
  };
}

describe("stdio logging", () => {
  const startedProcesses: ChildProcessWithoutNullStreams[] = [];

  afterEach(() => {
    while (startedProcesses.length > 0) {
      const child = startedProcesses.pop();
      child?.kill();
    }
  });

  it("keeps human-readable startup logs off stdout", async () => {
    const { badStdoutLines, send, serverProcess, waitForResponse } = startStdioServer();
    startedProcesses.push(serverProcess);

    const initPromise = waitForResponse(1);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "vitest-stdio-client",
          version: "1.0.0",
        },
      },
    });

    const initResponse = (await initPromise) as {
      result: { protocolVersion: string };
    };
    expect(initResponse.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);

    const toolsPromise = waitForResponse(2);
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    const toolsResponse = (await toolsPromise) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(toolsResponse.result.tools.length).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(badStdoutLines).toEqual([]);
  });
});
