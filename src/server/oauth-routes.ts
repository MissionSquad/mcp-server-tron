import type { Express, Request, Response } from "express";
import type { OAuthService } from "../oauth/OAuthService.js";
import { renderOAuthWalletPage } from "../oauth/page.js";
import type { TenantManager } from "../tenant/TenantManager.js";

export function registerOAuthRoutes(
  app: Express,
  params: {
    oauthService: OAuthService;
    tenantManager: TenantManager;
  },
): void {
  const { oauthService, tenantManager } = params;

  app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
    res.status(200).json(oauthService.getAuthorizationServerMetadata());
  });

  app.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
    res.status(200).json(oauthService.getProtectedResourceMetadata());
  });

  app.get("/oauth/authorize", async (req: Request, res: Response) => {
    try {
      const pending = await oauthService.createPendingAuthorization({
        responseType: readQueryString(req, "response_type"),
        clientId: readQueryString(req, "client_id"),
        redirectUri: readQueryString(req, "redirect_uri"),
        state: readQueryString(req, "state"),
        scope: readQueryString(req, "scope"),
        resource: readQueryString(req, "resource"),
        codeChallenge: readQueryString(req, "code_challenge"),
        codeChallengeMethod: readQueryString(req, "code_challenge_method"),
      });

      res.setHeader(
        "Set-Cookie",
        serializeCookie(oauthService.authCodeCookieName, pending.authRequestId, {
          httpOnly: true,
          secure: isSecureOrigin(oauthService.publicOrigin),
          sameSite: "Lax",
          path: "/oauth",
          maxAgeSeconds: Math.max(1, Math.floor((pending.expiresAt - pending.issuedAt) / 1000)),
        }),
      );
      res.status(200).type("html").send(renderOAuthWalletPage());
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/oauth/authorize/challenge", async (req: Request, res: Response) => {
    try {
      const authRequestId = requireAuthRequestCookie(req, oauthService.authCodeCookieName);
      const walletAddress = readBodyString(req, "walletAddress");
      const tenant = tenantManager.requireTenantByAddress(walletAddress);
      const challenge = oauthService.createWalletChallenge(authRequestId, tenant);

      res.status(200).json({
        challenge: challenge.challenge,
        expiresAt: challenge.expiresAt,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/oauth/authorize/verify", async (req: Request, res: Response) => {
    try {
      const authRequestId = requireAuthRequestCookie(req, oauthService.authCodeCookieName);
      const result = await oauthService.verifyWalletChallenge({
        authRequestId,
        tenantManager,
        walletAddress: readBodyString(req, "walletAddress"),
        challenge: readBodyString(req, "challenge"),
        signature: readBodyString(req, "signature"),
      });
      res.status(200).json({ redirectTo: result.redirectTo });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/oauth/authorize/create-wallet", async (req: Request, res: Response) => {
    try {
      const authRequestId = requireAuthRequestCookie(req, oauthService.authCodeCookieName);
      const result = await oauthService.createWalletAndAuthorize({
        authRequestId,
        tenantManager,
      });
      res.status(200).json({
        tenantId: result.wallet.tenantId,
        walletAddress: result.wallet.walletAddress,
        walletAddressHex: result.wallet.walletAddressHex,
        privateKey: result.wallet.privateKey,
        redirectTo: result.redirectTo,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/oauth/token", async (req: Request, res: Response) => {
    try {
      const tokenResponse = await oauthService.exchangeToken(toFlatRecord(req.body), tenantManager);
      res.status(200).json(tokenResponse);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function readQueryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function readBodyString(req: Request, key: string): string {
  const value = req.body?.[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}

function requireAuthRequestCookie(req: Request, cookieName: string): string {
  const cookies = parseCookieHeader(req.headers.cookie);
  const value = cookies[cookieName];
  if (!value) {
    throw new Error("OAuth authorization request cookie is missing.");
  }
  return value;
}

function parseCookieHeader(rawCookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!rawCookieHeader) {
    return result;
  }

  for (const part of rawCookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (name) {
      result[name] = decodeURIComponent(value);
    }
  }

  return result;
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
    path?: string;
    maxAgeSeconds?: number;
  },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path) {
    parts.push(`Path=${options.path}`);
  }
  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  return parts.join("; ");
}

function isSecureOrigin(origin: string): boolean {
  return origin.startsWith("https://");
}

function toFlatRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
