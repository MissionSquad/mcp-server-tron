import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { optionalOAuthTenantAuth } from "../../src/middleware/auth.js";

describe("optionalOAuthTenantAuth", () => {
  it("allows requests without Authorization and sets null tenantAuth", () => {
    const middleware = optionalOAuthTenantAuth({
      tenantManager: { getTenantById: vi.fn() } as any,
      jwtSecret: "jwt-secret",
      issuer: "https://tron-mcp.example.com",
      audience: "https://tron-mcp.example.com/mcp",
    });

    const req: any = { headers: {} };
    const res: any = {};
    const next = vi.fn();

    middleware(req, res, next);

    expect(req.tenantAuth).toBe(null);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("loads the tenant from a valid OAuth access token", () => {
    const tenant = {
      tenantId: "41abcdef",
      walletId: "primary",
      walletAddressBase58: "TExampleWalletAddress",
      walletAddressHex: "41abcdef",
      walletDir: "/tmp/tenant-wallet",
      createdAt: 0,
      updatedAt: 0,
      sessionVersion: 1,
    };

    const token = jwt.sign(
      {
        sub: tenant.tenantId,
        tenantId: tenant.tenantId,
        walletId: "primary",
        walletAddress: tenant.walletAddressBase58,
        clientId: "https://missionsquad.example.com/.well-known/oauth/client-metadata.json",
        scope: "mcp",
        sessionVersion: tenant.sessionVersion,
        iss: "https://tron-mcp.example.com",
        aud: "https://tron-mcp.example.com/mcp",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        jti: "token-1",
      },
      "jwt-secret",
      { algorithm: "HS256", noTimestamp: true },
    );

    const middleware = optionalOAuthTenantAuth({
      tenantManager: { getTenantById: vi.fn(() => tenant) } as any,
      jwtSecret: "jwt-secret",
      issuer: "https://tron-mcp.example.com",
      audience: "https://tron-mcp.example.com/mcp",
    });

    const req: any = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    };
    const res: any = {
      status: vi.fn(function (this: any) {
        return this;
      }),
      json: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(req.tenantAuth).toEqual({ tenant });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
