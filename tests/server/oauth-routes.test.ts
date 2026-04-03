import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OAuthService } from "../../src/oauth/OAuthService.js";
import { registerOAuthRoutes } from "../../src/server/oauth-routes.js";

describe("registerOAuthRoutes", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "tron-oauth-routes-"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          client_id: "https://missionsquad.example.com/.well-known/oauth/client-metadata.json",
          redirect_uris: ["https://missionsquad.example.com/webhooks/oauth/callback"],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("serves OAuth metadata and the authorization page", async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));

    const oauthService = new OAuthService({
      publicOrigin: "https://tron-mcp.example.com",
      jwtSecret: "jwt-secret",
      dataDir,
    });

    registerOAuthRoutes(app, {
      oauthService,
      tenantManager: { requireTenantByAddress: vi.fn(), createTenantWithNewWallet: vi.fn() } as any,
    });

    const authzLayer = (app as any)._router.stack.find(
      (layer: any) => layer.route?.path === "/.well-known/oauth-authorization-server",
    );
    const authorizeLayer = (app as any)._router.stack.find(
      (layer: any) => layer.route?.path === "/oauth/authorize" && layer.route?.methods?.get,
    );

    const metadataRes: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    authzLayer.route.stack[0].handle({}, metadataRes);
    expect(metadataRes.body.authorization_endpoint).toBe(
      "https://tron-mcp.example.com/oauth/authorize",
    );
    expect(metadataRes.body.client_id_metadata_document_supported).toBe(true);

    const authorizeRes: any = {
      statusCode: 200,
      headers: new Map<string, string>(),
      body: "",
      setHeader(name: string, value: string) {
        this.headers.set(name, value);
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      type() {
        return this;
      },
      send(payload: string) {
        this.body = payload;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };

    await authorizeLayer.route.stack[0].handle(
      {
        query: {
          response_type: "code",
          client_id: "https://missionsquad.example.com/.well-known/oauth/client-metadata.json",
          redirect_uri: "https://missionsquad.example.com/webhooks/oauth/callback",
          state: "abc123",
          scope: "mcp",
          resource: "https://tron-mcp.example.com/mcp",
          code_challenge: "challenge",
          code_challenge_method: "S256",
        },
      },
      authorizeRes,
    );

    expect(authorizeRes.statusCode).toBe(200);
    expect(authorizeRes.headers.get("Set-Cookie")).toContain("mcp_oauth_request=");
    expect(authorizeRes.body).toContain("Authorize TRON MCP Access");
  });
});
