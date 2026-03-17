import { randomUUID } from "node:crypto";
import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import startServer, { MCP_PROTOCOL_VERSION, version } from "./server.js";

type SessionContext = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

export type HttpAppContext = {
  app: express.Express;
  shutdown: () => Promise<void>;
  getActiveSessionCount: () => number;
};

export function createHttpApp(options: { readOnly?: boolean } = {}): HttpAppContext {
  const app = express();
  app.use(express.json({ limit: "10mb" })); // Prevent DoS attacks with huge payloads

  const sessions = new Map<string, SessionContext>();
  const sessionTimestamps = new Map<string, number>();
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  const cleanupExpiredSessions = () => {
    const now = Date.now();
    for (const [sessionId, timestamp] of sessionTimestamps.entries()) {
      if (now - timestamp > SESSION_TIMEOUT_MS) {
        console.error(`Cleaning up stale session: ${sessionId}`);
        const session = sessions.get(sessionId);
        if (session) {
          session.transport
            .close()
            .catch((err) => console.error(`Error closing stale session ${sessionId}:`, err));
        }
        sessions.delete(sessionId);
        sessionTimestamps.delete(sessionId);
      }
    }
  };

  const cleanupInterval = setInterval(cleanupExpiredSessions, 5 * 60 * 1000);
  cleanupInterval.unref?.();

  async function createSessionContext(): Promise<SessionContext> {
    const server = await startServer({ readOnly: options.readOnly });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        console.error(`Session initialized: ${newSessionId}`);
        sessions.set(newSessionId, { server, transport });
        sessionTimestamps.set(newSessionId, Date.now());
      },
      onsessionclosed: (closedSessionId) => {
        console.error(`Session closed: ${closedSessionId}`);
        sessions.delete(closedSessionId);
        sessionTimestamps.delete(closedSessionId);
      },
    });

    await server.connect(transport);
    console.error("New transport connected to server");

    return { server, transport };
  }

  app.post("/mcp", async (req: Request, res: Response) => {
    console.error(`Received POST /mcp request from ${req.ip}`);

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && sessions.has(sessionId)) {
      transport = sessions.get(sessionId)!.transport;
      sessionTimestamps.set(sessionId, Date.now());
      console.error(`Reusing transport for session: ${sessionId}`);
    } else if (!sessionId) {
      ({ transport } = await createSessionContext());
    } else {
      console.error(`Invalid session ID: ${sessionId}`);
      res.status(404).json({ error: "Session not found" });
      return;
    }

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`Error handling request: ${error}`);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    console.error(`Received GET /mcp request from ${req.ip}`);

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId) {
      res.setHeader("Allow", "POST, DELETE");
      res.status(405).json({ error: "Session ID required for GET" });
      return;
    }

    if (!sessions.has(sessionId)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const transport = sessions.get(sessionId)!.transport;
    sessionTimestamps.set(sessionId, Date.now());

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error(`Error handling SSE request: ${error}`);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const transport = sessions.get(sessionId)!.transport;

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error(`Error closing session: ${error}`);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      server: "ready",
      activeSessions: sessions.size,
    });
  });

  app.get("/", (_req: Request, res: Response) => {
    res.status(200).json({
      name: "mcp-server-tron",
      version,
      protocol: `MCP ${MCP_PROTOCOL_VERSION}`,
      transport: "Streamable HTTP",
      endpoints: {
        mcp: "/mcp",
        health: "/health",
      },
      status: "ready",
      activeSessions: sessions.size,
    });
  });

  const shutdown = async () => {
    clearInterval(cleanupInterval);
    for (const [sessionId, session] of sessions) {
      console.error(`Closing transport for session: ${sessionId}`);
      await session.transport.close();
    }
    sessions.clear();
    sessionTimestamps.clear();
  };

  return {
    app,
    shutdown,
    getActiveSessionCount: () => sessions.size,
  };
}
