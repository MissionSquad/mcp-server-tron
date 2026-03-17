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

async function initializeTransport(transport: WebStandardStreamableHTTPServerTransport) {
  const response = await transport.handleRequest(
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
          clientInfo: {
            name: "vitest-client",
            version: "1.0.0",
          },
        },
      }),
    }),
  );

  expect(response.status).toBe(200);

  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();

  const payload = (await readFirstSseMessage(response)) as { result: { protocolVersion: string } };
  expect(payload.result.protocolVersion).toBe(PROTOCOL_VERSION);

  return sessionId!;
}

async function sendInitializedNotification(
  transport: WebStandardStreamableHTTPServerTransport,
  sessionId: string,
) {
  const response = await transport.handleRequest(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
        "mcp-protocol-version": PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }),
    }),
  );

  expect(response.status).toBe(202);
}

async function sendPing(
  transport: WebStandardStreamableHTTPServerTransport,
  sessionId: string,
  id: number,
) {
  const response = await transport.handleRequest(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
        "mcp-protocol-version": PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "ping",
        params: {},
      }),
    }),
  );

  expect(response.status).toBe(200);
  return (await readFirstSseMessage(response)) as { id: number; result: Record<string, never> };
}

describe("Streamable HTTP session lifecycle", () => {
  const serversToClose: Awaited<ReturnType<typeof startServer>>[] = [];

  afterEach(async () => {
    while (serversToClose.length > 0) {
      const server = serversToClose.pop();
      await server?.close();
    }
  });

  it("rejects connecting a second transport to the same MCP server", async () => {
    const server = await startServer({ readOnly: true });
    serversToClose.push(server);

    const firstTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => "session-a",
    });
    const secondTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => "session-b",
    });

    await server.connect(firstTransport);

    await expect(server.connect(secondTransport)).rejects.toThrow(
      "Already connected to a transport",
    );
  });

  it("keeps a session usable after initialize", async () => {
    const server = await startServer({ readOnly: true });
    serversToClose.push(server);

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => "session-a",
    });

    await server.connect(transport);

    const sessionId = await initializeTransport(transport);
    await sendInitializedNotification(transport, sessionId);

    const pingResponse = await sendPing(transport, sessionId, 2);

    expect(pingResponse.id).toBe(2);
    expect(pingResponse.result).toEqual({});
  });

  it("supports multiple independent sessions when each has its own server", async () => {
    const serverA = await startServer({ readOnly: true });
    const serverB = await startServer({ readOnly: true });
    serversToClose.push(serverA, serverB);

    const transportA = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => "session-a",
    });
    const transportB = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => "session-b",
    });

    await serverA.connect(transportA);
    await serverB.connect(transportB);

    const sessionA = await initializeTransport(transportA);
    const sessionB = await initializeTransport(transportB);

    await sendInitializedNotification(transportA, sessionA);
    await sendInitializedNotification(transportB, sessionB);

    const pingA = await sendPing(transportA, sessionA, 11);
    const pingB = await sendPing(transportB, sessionB, 22);

    expect(pingA.id).toBe(11);
    expect(pingB.id).toBe(22);
  });
});
