import type express from "express";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { OAuthAccessTokenPayload } from "../oauth/types.js";
import type { TenantManager } from "../tenant/TenantManager.js";

declare global {
  namespace Express {
    interface Request {
      tenantAuth?: {
        tenant: import("../tenant/types.js").TenantRecord;
      } | null;
    }
  }
}

export function optionalOAuthTenantAuth(params: {
  tenantManager: TenantManager;
  jwtSecret: string;
  issuer: string;
  audience: string;
}): express.RequestHandler {
  return (req: Request, res: Response, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
      req.tenantAuth = null;
      next();
      return;
    }

    if (!authorization.startsWith("Bearer ")) {
      res.status(401).json({ error: "Invalid Authorization header format." });
      return;
    }

    const token = authorization.slice("Bearer ".length).trim();
    if (!token) {
      res.status(401).json({ error: "Missing bearer token." });
      return;
    }

    try {
      const payload = jwt.verify(token, params.jwtSecret, {
        algorithms: ["HS256"],
        issuer: params.issuer,
        audience: params.audience,
      }) as OAuthAccessTokenPayload;

      const tenant = params.tenantManager.getTenantById(payload.tenantId);
      if (!tenant) {
        res.status(401).json({ error: "Tenant not found for access token." });
        return;
      }
      if (tenant.sessionVersion !== payload.sessionVersion) {
        res.status(401).json({ error: "OAuth token session is no longer valid." });
        return;
      }

      req.tenantAuth = { tenant };
      next();
    } catch (error) {
      res.status(401).json({
        error: error instanceof Error ? error.message : "Invalid access token.",
      });
    }
  };
}
