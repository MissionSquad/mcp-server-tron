import { afterEach, describe, expect, it } from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import startServer from "../../src/server/server.js";

const PROTOCOL_VERSION = "2025-06-18";

async function readFirstSseMessage(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader!.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const eventEnd = buffer.indexOf("\n\n");
      if (eventEnd === -1) {
        continue;
      }

      const eventBlock = buffer.slice(0, eventEnd);
      const dataLine = eventBlock.split("\n").find((line) => line.startsWith("data:"));

      expect(dataLine).toBeDefined();
      return JSON.parse(dataLine!.slice(5).trim());
    }
  } finally {
    await reader?.cancel();
  }

  throw new Error("No SSE message received");
}

async function sendStatelessRequest(body: Record<string, unknown>) {
  const server = await startServer({ readOnly: true });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  const response = await transport.handleRequest(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    }),
  );

  return { server, response };
}

describe("Streamable HTTP stateless lifecycle", () => {
  const serversToClose: Awaited<ReturnType<typeof startServer>>[] = [];

  afterEach(async () => {
    while (serversToClose.length > 0) {
      const server = serversToClose.pop();
      await server?.close();
    }
  });

  it("allows initialize without returning an MCP session id", async () => {
    const { server, response } = await sendStatelessRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "vitest-client",
          version: "1.0.0",
        },
      },
    });
    serversToClose.push(server);

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();

    const payload = (await readFirstSseMessage(response)) as {
      result: { protocolVersion: string };
    };
    expect(payload.result.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("handles tools/list as an independent stateless request", async () => {
    const { server, response } = await sendStatelessRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    serversToClose.push(server);

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();

    const payload = (await readFirstSseMessage(response)) as {
      id: number;
      result: { tools: Array<{ name: string }> };
    };
    expect(payload.id).toBe(2);
    expect(payload.result.tools.length).toBeGreaterThan(0);
  });

  it("does not allow reusing a stateless transport across requests", async () => {
    const server = await startServer({ readOnly: true });
    serversToClose.push(server);

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);

    const firstResponse = await transport.handleRequest(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "vitest-client", version: "1.0.0" },
          },
        }),
      }),
    );

    expect(firstResponse.status).toBe(200);

    await expect(
      transport.handleRequest(
        new Request("https://example.test/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "ping",
            params: {},
          }),
        }),
      ),
    ).rejects.toThrow("Stateless transport cannot be reused across requests");
  });
});
