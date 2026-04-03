import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OAuthService } from "../../src/oauth/OAuthService.js";
import type { TenantRecord } from "../../src/tenant/types.js";

describe("OAuthService", () => {
  let dataDir: string;
  let oauthService: OAuthService;
  let tenant: TenantRecord;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "tron-oauth-service-"));
    oauthService = new OAuthService({
      publicOrigin: "https://tron-mcp.example.com",
      jwtSecret: "jwt-secret",
      dataDir,
      oauthAccessTokenTtlSeconds: 3600,
      oauthRefreshTokenTtlSeconds: 3600,
    });
    tenant = {
      tenantId: "41abcdef",
      walletId: "primary",
      walletAddressBase58: "TExampleWalletAddress",
      walletAddressHex: "41abcdef",
      walletDir: "/tmp/tenant-wallet",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionVersion: 1,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          client_id: "https://missionsquad.example.com/.well-known/oauth/client-metadata.json",
          redirect_uris: ["https://missionsquad.example.com/webhooks/oauth/callback"],
          grant_types: ["authorization_code", "refresh_token"],
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

  it("creates a pending authorization request after validating CIMD metadata", async () => {
    const pending = await oauthService.createPendingAuthorization({
      responseType: "code",
      clientId: "https://missionsquad.example.com/.well-known/oauth/client-metadata.json",
      redirectUri: "https://missionsquad.example.com/webhooks/oauth/callback",
      state: "abc123",
      scope: "mcp",
      resource: "https://tron-mcp.example.com/mcp",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
    });

    expect(pending.clientId).toBe(
      "https://missionsquad.example.com/.well-known/oauth/client-metadata.json",
    );
    expect(pending.redirectUri).toBe("https://missionsquad.example.com/webhooks/oauth/callback");
    expect(pending.scope).toEqual(["mcp"]);
  });

  it("creates a wallet authorization code and exchanges it for OAuth tokens", async () => {
    const codeVerifier = "code-verifier";
    const pending = await oauthService.createPendingAuthorization({
      responseType: "code",
      clientId: "https://missionsquad.example.com/.well-known/oauth/client-metadata.json",
      redirectUri: "https://missionsquad.example.com/webhooks/oauth/callback",
      state: "abc123",
      scope: "mcp",
      resource: "https://tron-mcp.example.com/mcp",
      codeChallenge: buildPkceChallenge(codeVerifier),
      codeChallengeMethod: "S256",
    });

    const tenantManager = {
      createTenantWithNewWallet: vi.fn(async () => ({
        tenant,
        wallet: {
          tenantId: tenant.tenantId,
          walletAddress: tenant.walletAddressBase58,
          walletAddressHex: tenant.walletAddressHex,
          privateKey: "abc",
        },
      })),
      getTenantById: vi.fn((tenantId: string) => (tenantId === tenant.tenantId ? tenant : null)),
    } as any;

    const created = await oauthService.createWalletAndAuthorize({
      authRequestId: pending.authRequestId,
      tenantManager,
    });

    const redirectUrl = new URL(created.redirectTo);
    const code = redirectUrl.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenResponse = await oauthService.exchangeToken(
      {
        grant_type: "authorization_code",
        code,
        client_id: pending.clientId,
        redirect_uri: pending.redirectUri,
        code_verifier: codeVerifier,
        resource: "https://tron-mcp.example.com/mcp",
      },
      tenantManager,
    );

    expect(tokenResponse.token_type).toBe("Bearer");
    expect(tokenResponse.access_token.length).toBeGreaterThan(0);
    expect(tokenResponse.refresh_token?.length).toBeGreaterThan(0);

    const accessPayload = oauthService.verifyAccessToken(tokenResponse.access_token);
    expect(accessPayload.tenantId).toBe(tenant.tenantId);
    expect(accessPayload.walletAddress).toBe(tenant.walletAddressBase58);
  });

  it("rotates refresh tokens", async () => {
    const codeVerifier = "code-verifier";
    const pending = await oauthService.createPendingAuthorization({
      responseType: "code",
      clientId: "https://missionsquad.example.com/.well-known/oauth/client-metadata.json",
      redirectUri: "https://missionsquad.example.com/webhooks/oauth/callback",
      state: "abc123",
      scope: "mcp",
      resource: "https://tron-mcp.example.com/mcp",
      codeChallenge: buildPkceChallenge(codeVerifier),
      codeChallengeMethod: "S256",
    });

    const tenantManager = {
      createTenantWithNewWallet: vi.fn(async () => ({
        tenant,
        wallet: {
          tenantId: tenant.tenantId,
          walletAddress: tenant.walletAddressBase58,
          walletAddressHex: tenant.walletAddressHex,
          privateKey: "abc",
        },
      })),
      getTenantById: vi.fn((tenantId: string) => (tenantId === tenant.tenantId ? tenant : null)),
    } as any;

    const created = await oauthService.createWalletAndAuthorize({
      authRequestId: pending.authRequestId,
      tenantManager,
    });
    const code = new URL(created.redirectTo).searchParams.get("code");

    const initialTokenResponse = await oauthService.exchangeToken(
      {
        grant_type: "authorization_code",
        code,
        client_id: pending.clientId,
        redirect_uri: pending.redirectUri,
        code_verifier: codeVerifier,
      },
      tenantManager,
    );

    const refreshed = await oauthService.exchangeToken(
      {
        grant_type: "refresh_token",
        refresh_token: initialTokenResponse.refresh_token,
        client_id: pending.clientId,
      },
      tenantManager,
    );

    expect(refreshed.access_token).not.toBe(initialTokenResponse.access_token);
    expect(refreshed.refresh_token).not.toBe(initialTokenResponse.refresh_token);
  });
});

function buildPkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
}
