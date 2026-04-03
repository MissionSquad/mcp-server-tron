import { join } from "node:path";
import express, { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { optionalOAuthTenantAuth } from "../middleware/auth.js";
import { OAuthService } from "../oauth/OAuthService.js";
import { runWithRequestContext } from "../tenant/context.js";
import { TenantManager } from "../tenant/TenantManager.js";
import { registerOAuthRoutes } from "./oauth-routes.js";
import startServer, { MCP_PROTOCOL_VERSION, version } from "./server.js";

export type HttpAppContext = {
  app: express.Express;
  shutdown: () => Promise<void>;
  getActiveSessionCount: () => number;
};

export function createHttpApp(options: { readOnly?: boolean } = {}): HttpAppContext {
  const publicOrigin = process.env.MCP_PUBLIC_ORIGIN?.trim();
  const jwtSecret = process.env.JWT_SECRET?.trim();
  const tenantMasterSecret = process.env.MCP_TENANT_MASTER_SECRET?.trim();

  if (!publicOrigin) {
    throw new Error("MCP_PUBLIC_ORIGIN is required in HTTP mode.");
  }
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is required in HTTP mode.");
  }
  if (!tenantMasterSecret) {
    throw new Error("MCP_TENANT_MASTER_SECRET is required in HTTP mode.");
  }

  const dataDir = process.env.MCP_DATA_DIR?.trim() || join(process.cwd(), "data");
  const tenantManager = new TenantManager({
    dataDir,
    tenantMasterSecret,
  });
  const oauthService = new OAuthService({
    publicOrigin,
    jwtSecret,
    dataDir,
    authChallengeTtlSeconds: parsePositiveInt(process.env.MCP_AUTH_CHALLENGE_TTL_SECONDS) ?? 300,
    oauthAuthCodeTtlSeconds: parsePositiveInt(process.env.MCP_OAUTH_AUTH_CODE_TTL_SECONDS) ?? 300,
    oauthAccessTokenTtlSeconds:
      parsePositiveInt(process.env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS) ?? 3600,
    oauthRefreshTokenTtlSeconds:
      parsePositiveInt(process.env.MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS) ?? 2_592_000,
    clientMetadataTimeoutMs:
      parsePositiveInt(process.env.MCP_OAUTH_CLIENT_METADATA_TIMEOUT_MS) ?? 10_000,
  });

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false }));

  registerOAuthRoutes(app, { oauthService, tenantManager });
  app.use(
    optionalOAuthTenantAuth({
      tenantManager,
      jwtSecret,
      issuer: oauthService.publicOrigin,
      audience: oauthService.resourceUri,
    }),
  );

  app.post("/mcp", async (req: Request, res: Response) => {
    console.log(`Received POST /mcp request from ${req.ip}`);
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await runWithRequestContext(
        {
          transport: "http",
          tenantManager,
          auth: req.tenantAuth ?? null,
        },
        async () => {
          server = await startServer({ readOnly: options.readOnly, transport: "http" });
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
        },
      );
    } catch (error) {
      console.error(`Error handling request: ${error}`);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    } finally {
      if (server) {
        await server.close().catch((closeError) => {
          console.error(`Error closing stateless server: ${closeError}`);
        });
      }
    }
  });

  app.get("/mcp", async (_req: Request, res: Response) => {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "GET not supported for stateless Streamable HTTP" });
  });

  app.delete("/mcp", async (_req: Request, res: Response) => {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "DELETE not supported for stateless Streamable HTTP" });
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      server: "ready",
      mode: "stateless",
      activeSessions: 0,
    });
  });

  app.get("/", (_req: Request, res: Response) => {
    res.status(200).json({
      name: "mcp-server-tron",
      version,
      protocol: `MCP ${MCP_PROTOCOL_VERSION}`,
      transport: "Streamable HTTP",
      mode: "stateless",
      endpoints: {
        mcp: "/mcp",
        health: "/health",
        authorize: "/oauth/authorize",
        token: "/oauth/token",
      },
      status: "ready",
      activeSessions: 0,
    });
  });

  return {
    app,
    shutdown: async () => {},
    getActiveSessionCount: () => 0,
  };
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}
