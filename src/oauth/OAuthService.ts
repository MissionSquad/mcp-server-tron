import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import { getTronWeb } from "../core/services/clients.js";
import type { TenantManager } from "../tenant/TenantManager.js";
import type { TenantRecord } from "../tenant/types.js";
import type {
  AuthorizationCodeRecord,
  ChallengeRecord,
  OAuthAccessTokenPayload,
  PendingAuthorizationRequest,
  RefreshTokenRecord,
} from "./types.js";

const DEFAULT_SCOPE = "mcp";
const AUTH_CODE_COOKIE_NAME = "mcp_oauth_request";
const NONCE_REGEX = /^Nonce:\s+([A-Za-z0-9_-]+)$/m;

export interface OAuthServiceOptions {
  publicOrigin: string;
  jwtSecret: string;
  dataDir: string;
  authChallengeTtlSeconds?: number;
  oauthAuthCodeTtlSeconds?: number;
  oauthAccessTokenTtlSeconds?: number;
  oauthRefreshTokenTtlSeconds?: number;
  clientMetadataTimeoutMs?: number;
}

export class OAuthService {
  public readonly publicOrigin: string;
  public readonly resourceUri: string;
  public readonly authCodeCookieName = AUTH_CODE_COOKIE_NAME;

  private readonly jwtSecret: string;
  private readonly dataDir: string;
  private readonly authChallengeTtlSeconds: number;
  private readonly oauthAuthCodeTtlSeconds: number;
  private readonly oauthAccessTokenTtlSeconds: number;
  private readonly oauthRefreshTokenTtlSeconds: number;
  private readonly clientMetadataTimeoutMs: number;
  private readonly pendingAuthorizations = new Map<string, PendingAuthorizationRequest>();
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly authorizationCodes = new Map<string, AuthorizationCodeRecord>();

  constructor(options: OAuthServiceOptions) {
    this.publicOrigin = trimTrailingSlash(options.publicOrigin);
    this.resourceUri = `${this.publicOrigin}/mcp`;
    this.jwtSecret = options.jwtSecret;
    this.dataDir = options.dataDir;
    this.authChallengeTtlSeconds = options.authChallengeTtlSeconds ?? 300;
    this.oauthAuthCodeTtlSeconds = options.oauthAuthCodeTtlSeconds ?? 300;
    this.oauthAccessTokenTtlSeconds = options.oauthAccessTokenTtlSeconds ?? 3600;
    this.oauthRefreshTokenTtlSeconds = options.oauthRefreshTokenTtlSeconds ?? 2_592_000;
    this.clientMetadataTimeoutMs = options.clientMetadataTimeoutMs ?? 10_000;
  }

  getAuthorizationServerMetadata() {
    return {
      issuer: this.publicOrigin,
      authorization_endpoint: `${this.publicOrigin}/oauth/authorize`,
      token_endpoint: `${this.publicOrigin}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    };
  }

  getProtectedResourceMetadata() {
    return {
      resource: this.resourceUri,
      authorization_servers: [this.publicOrigin],
      bearer_methods_supported: ["header"],
    };
  }

  async createPendingAuthorization(params: {
    responseType?: string;
    clientId?: string;
    redirectUri?: string;
    state?: string;
    scope?: string;
    resource?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    now?: number;
  }): Promise<PendingAuthorizationRequest> {
    const responseType = params.responseType?.trim();
    const clientId = params.clientId?.trim();
    const redirectUri = params.redirectUri?.trim();
    const state = params.state?.trim();
    const codeChallenge = params.codeChallenge?.trim();
    const codeChallengeMethod = params.codeChallengeMethod?.trim();

    if (responseType !== "code") {
      throw new Error("response_type must be 'code'.");
    }
    if (!clientId) {
      throw new Error("client_id is required.");
    }
    if (!redirectUri) {
      throw new Error("redirect_uri is required.");
    }
    if (!state) {
      throw new Error("state is required.");
    }
    if (!codeChallenge) {
      throw new Error("code_challenge is required.");
    }
    if (codeChallengeMethod !== "S256") {
      throw new Error("code_challenge_method must be 'S256'.");
    }
    if (params.resource && trimTrailingSlash(params.resource) !== this.resourceUri) {
      throw new Error(`resource must be '${this.resourceUri}'.`);
    }

    await this.validateClientMetadata(clientId, redirectUri);

    const now = params.now ?? Date.now();
    const request: PendingAuthorizationRequest = {
      authRequestId: randomUUID(),
      clientId,
      redirectUri,
      state,
      scope: parseScopes(params.scope),
      resource: this.resourceUri,
      codeChallenge,
      codeChallengeMethod: "S256",
      issuedAt: now,
      expiresAt: now + this.oauthAuthCodeTtlSeconds * 1000,
    };

    this.pendingAuthorizations.set(request.authRequestId, request);
    return request;
  }

  getPendingAuthorization(authRequestId: string): PendingAuthorizationRequest {
    const request = this.pendingAuthorizations.get(authRequestId);
    if (!request) {
      throw new Error("OAuth authorization request not found.");
    }
    if (Date.now() > request.expiresAt) {
      this.pendingAuthorizations.delete(authRequestId);
      throw new Error("OAuth authorization request expired.");
    }
    return request;
  }

  createWalletChallenge(
    authRequestId: string,
    tenant: TenantRecord,
    now = Date.now(),
  ): ChallengeRecord {
    const pending = this.getPendingAuthorization(authRequestId);
    const nonce = randomUUID();
    const issuedAtIso = new Date(now).toISOString();
    const expiresAt = now + this.authChallengeTtlSeconds * 1000;
    const expiresAtIso = new Date(expiresAt).toISOString();

    const challenge = [
      "MissionSquad TRON MCP OAuth Login",
      "Version: 1",
      "Purpose: Authorize managed wallet access",
      `Address: ${tenant.walletAddressBase58}`,
      `Tenant: ${tenant.tenantId}`,
      `Client ID: ${pending.clientId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAtIso}`,
      `Expires At: ${expiresAtIso}`,
    ].join("\n");

    const record: ChallengeRecord = {
      nonce,
      authRequestId,
      tenantId: tenant.tenantId,
      walletAddressBase58: tenant.walletAddressBase58,
      walletAddressHex: tenant.walletAddressHex,
      challenge,
      issuedAt: now,
      expiresAt,
      usedAt: null,
    };

    this.challenges.set(record.nonce, record);
    return record;
  }

  async verifyWalletChallenge(params: {
    authRequestId: string;
    tenantManager: TenantManager;
    walletAddress: string;
    challenge: string;
    signature: string;
    now?: number;
  }): Promise<{ redirectTo: string; tenant: TenantRecord }> {
    const pending = this.getPendingAuthorization(params.authRequestId);
    const tenant = params.tenantManager.requireTenantByAddress(params.walletAddress);
    const challenge = this.requireChallenge(params.challenge);
    const now = params.now ?? Date.now();

    if (challenge.authRequestId !== params.authRequestId) {
      challenge.usedAt = now;
      throw new Error("Challenge does not belong to the current OAuth authorization request.");
    }
    if (challenge.tenantId !== tenant.tenantId) {
      challenge.usedAt = now;
      throw new Error("Challenge tenant does not match the requested wallet.");
    }
    if (challenge.challenge !== params.challenge) {
      challenge.usedAt = now;
      throw new Error("Challenge text mismatch.");
    }
    if (challenge.usedAt !== null) {
      throw new Error("Challenge has already been used.");
    }
    if (now > challenge.expiresAt) {
      challenge.usedAt = now;
      throw new Error("Challenge expired.");
    }

    challenge.usedAt = now;

    const recoveredAddress = await getTronWeb("mainnet").trx.verifyMessageV2(
      params.challenge,
      params.signature,
    );
    const normalizedRecovered = params.tenantManager.normalizeAddress(recoveredAddress);
    if (normalizedRecovered.walletAddressBase58 !== tenant.walletAddressBase58) {
      throw new Error("Wallet signature verification failed.");
    }

    const code = this.issueAuthorizationCode(pending, tenant, now);
    return {
      redirectTo: buildRedirectUrl(pending.redirectUri, code.code, pending.state),
      tenant,
    };
  }

  async createWalletAndAuthorize(params: {
    authRequestId: string;
    tenantManager: TenantManager;
    now?: number;
  }): Promise<{
    redirectTo: string;
    tenant: TenantRecord;
    wallet: {
      tenantId: string;
      walletAddress: string;
      walletAddressHex: string;
      privateKey: string;
    };
  }> {
    const pending = this.getPendingAuthorization(params.authRequestId);
    const created = await params.tenantManager.createTenantWithNewWallet();
    const code = this.issueAuthorizationCode(pending, created.tenant, params.now ?? Date.now());

    return {
      redirectTo: buildRedirectUrl(pending.redirectUri, code.code, pending.state),
      tenant: created.tenant,
      wallet: {
        tenantId: created.tenant.tenantId,
        walletAddress: created.wallet.address,
        walletAddressHex: created.wallet.addressHex,
        privateKey: created.wallet.privateKey,
      },
    };
  }

  async exchangeToken(
    body: Record<string, unknown>,
    tenantManager: TenantManager,
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    token_type: "Bearer";
    expires_in: number;
    scope: string;
  }> {
    const grantType = readRequiredString(body, "grant_type");
    if (grantType === "authorization_code") {
      return this.exchangeAuthorizationCode(body, tenantManager);
    }
    if (grantType === "refresh_token") {
      return this.exchangeRefreshToken(body, tenantManager);
    }
    throw new Error("Unsupported grant_type.");
  }

  verifyAccessToken(token: string): OAuthAccessTokenPayload {
    return jwt.verify(token, this.jwtSecret, {
      algorithms: ["HS256"],
      issuer: this.publicOrigin,
      audience: this.resourceUri,
    }) as OAuthAccessTokenPayload;
  }

  private async exchangeAuthorizationCode(
    body: Record<string, unknown>,
    tenantManager: TenantManager,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    token_type: "Bearer";
    expires_in: number;
    scope: string;
  }> {
    const code = readRequiredString(body, "code");
    const clientId = readRequiredString(body, "client_id");
    const redirectUri = readRequiredString(body, "redirect_uri");
    const codeVerifier = readRequiredString(body, "code_verifier");
    const resource = readOptionalString(body, "resource");
    if (resource && trimTrailingSlash(resource) !== this.resourceUri) {
      throw new Error(`resource must be '${this.resourceUri}'.`);
    }

    await this.validateClientMetadata(clientId, redirectUri);

    const record = this.authorizationCodes.get(code);
    if (!record) {
      throw new Error("Authorization code not found.");
    }
    if (record.usedAt !== null) {
      throw new Error("Authorization code has already been used.");
    }
    if (Date.now() > record.expiresAt) {
      this.authorizationCodes.delete(code);
      throw new Error("Authorization code expired.");
    }
    if (record.clientId !== clientId) {
      throw new Error("Authorization code client_id mismatch.");
    }
    if (record.redirectUri !== redirectUri) {
      throw new Error("Authorization code redirect_uri mismatch.");
    }
    if (buildPkceChallenge(codeVerifier) !== record.codeChallenge) {
      throw new Error("Invalid code_verifier.");
    }

    record.usedAt = Date.now();

    const tenant = tenantManager.getTenantById(record.tenantId);
    if (!tenant) {
      throw new Error("Tenant not found for authorization code.");
    }

    const accessToken = this.issueAccessToken({
      tenant,
      clientId,
      scopes: record.scope,
    });
    const refreshToken = this.issueRefreshToken({
      tenant,
      clientId,
      scopes: record.scope,
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: this.oauthAccessTokenTtlSeconds,
      scope: record.scope.join(" "),
    };
  }

  private async exchangeRefreshToken(
    body: Record<string, unknown>,
    tenantManager: TenantManager,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    token_type: "Bearer";
    expires_in: number;
    scope: string;
  }> {
    const refreshToken = readRequiredString(body, "refresh_token");
    const clientId = readRequiredString(body, "client_id");
    const record = this.loadRefreshTokenRecord(refreshToken);

    if (record.revokedAt !== null) {
      throw new Error("Refresh token revoked.");
    }
    if (record.rotatedAt !== null) {
      throw new Error("Refresh token already rotated.");
    }
    if (Date.now() > record.expiresAt) {
      throw new Error("Refresh token expired.");
    }
    if (record.clientId !== clientId) {
      throw new Error("Refresh token client_id mismatch.");
    }

    const tenant = tenantManager.getTenantById(record.tenantId);
    if (!tenant) {
      throw new Error("Tenant not found for refresh token.");
    }
    if (tenant.sessionVersion !== record.sessionVersion) {
      throw new Error("Refresh token session version mismatch.");
    }

    const newAccessToken = this.issueAccessToken({
      tenant,
      clientId,
      scopes: record.scopes,
    });
    const newRefreshToken = this.issueRefreshToken({
      tenant,
      clientId,
      scopes: record.scopes,
    });
    const newTokenHash = hashOpaqueToken(newRefreshToken);

    const updatedRecord: RefreshTokenRecord = {
      ...record,
      rotatedAt: Date.now(),
      replacedByTokenHash: newTokenHash,
    };
    this.writeRefreshTokenRecord(updatedRecord);

    return {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      token_type: "Bearer",
      expires_in: this.oauthAccessTokenTtlSeconds,
      scope: record.scopes.join(" "),
    };
  }

  private issueAuthorizationCode(
    pending: PendingAuthorizationRequest,
    tenant: TenantRecord,
    now = Date.now(),
  ): AuthorizationCodeRecord {
    const code = randomBytes(32).toString("base64url");
    const record: AuthorizationCodeRecord = {
      code,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      tenantId: tenant.tenantId,
      walletAddressBase58: tenant.walletAddressBase58,
      walletId: "primary",
      scope: pending.scope,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      issuedAt: now,
      expiresAt: now + this.oauthAuthCodeTtlSeconds * 1000,
      usedAt: null,
    };
    this.authorizationCodes.set(code, record);
    return record;
  }

  private issueAccessToken(params: {
    tenant: TenantRecord;
    clientId: string;
    scopes: string[];
  }): string {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + this.oauthAccessTokenTtlSeconds;
    const payload: OAuthAccessTokenPayload = {
      sub: params.tenant.tenantId,
      tenantId: params.tenant.tenantId,
      walletId: "primary",
      walletAddress: params.tenant.walletAddressBase58,
      clientId: params.clientId,
      scope: params.scopes.join(" "),
      sessionVersion: params.tenant.sessionVersion,
      iss: this.publicOrigin,
      aud: this.resourceUri,
      iat,
      exp,
      jti: randomUUID(),
    };

    return jwt.sign(payload, this.jwtSecret, {
      algorithm: "HS256",
      noTimestamp: true,
    });
  }

  private issueRefreshToken(params: {
    tenant: TenantRecord;
    clientId: string;
    scopes: string[];
  }): string {
    const refreshToken = randomBytes(48).toString("base64url");
    const record: RefreshTokenRecord = {
      tokenHash: hashOpaqueToken(refreshToken),
      tenantId: params.tenant.tenantId,
      walletAddressBase58: params.tenant.walletAddressBase58,
      walletId: "primary",
      clientId: params.clientId,
      scopes: params.scopes,
      sessionVersion: params.tenant.sessionVersion,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.oauthRefreshTokenTtlSeconds * 1000,
      rotatedAt: null,
      revokedAt: null,
      replacedByTokenHash: null,
    };
    this.writeRefreshTokenRecord(record);
    return refreshToken;
  }

  private loadRefreshTokenRecord(refreshToken: string): RefreshTokenRecord {
    const tokenHash = hashOpaqueToken(refreshToken);
    const filePath = this.getRefreshTokenPath(tokenHash);
    if (!existsSync(filePath)) {
      throw new Error("Refresh token not found.");
    }
    return JSON.parse(readFileSync(filePath, "utf-8")) as RefreshTokenRecord;
  }

  private writeRefreshTokenRecord(record: RefreshTokenRecord): void {
    mkdirSync(this.getRefreshTokenDir(), { recursive: true });
    writeJsonAtomic(this.getRefreshTokenPath(record.tokenHash), record);
  }

  private getRefreshTokenDir(): string {
    return join(this.dataDir, "oauth", "refresh-tokens");
  }

  private getRefreshTokenPath(tokenHash: string): string {
    return join(this.getRefreshTokenDir(), `${tokenHash}.json`);
  }

  private requireChallenge(challengeText: string): ChallengeRecord {
    const nonce = extractNonce(challengeText);
    const record = this.challenges.get(nonce);
    if (!record) {
      throw new Error("Challenge not found.");
    }
    return record;
  }

  private async validateClientMetadata(clientId: string, redirectUri: string): Promise<void> {
    const clientUrl = new URL(clientId);
    if (!isAllowedClientMetadataUrl(clientUrl)) {
      throw new Error("client_id must be an HTTPS URL, or localhost HTTP in development.");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.clientMetadataTimeoutMs);
    let response: Response;
    try {
      response = await fetch(clientId, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`Unable to load client metadata from client_id URL: ${response.status}`);
    }

    const metadata = (await response.json()) as Record<string, unknown>;
    if (typeof metadata.client_id !== "string" || metadata.client_id !== clientId) {
      throw new Error("Client metadata client_id mismatch.");
    }

    const redirectUris = Array.isArray(metadata.redirect_uris)
      ? metadata.redirect_uris.filter((value): value is string => typeof value === "string")
      : [];
    if (!redirectUris.includes(redirectUri)) {
      throw new Error("redirect_uri is not allowed by the client metadata document.");
    }

    const grantTypes = Array.isArray(metadata.grant_types)
      ? metadata.grant_types.filter((value): value is string => typeof value === "string")
      : [];
    if (!grantTypes.includes("authorization_code")) {
      throw new Error("Client metadata must allow authorization_code grant type.");
    }

    const responseTypes = Array.isArray(metadata.response_types)
      ? metadata.response_types.filter((value): value is string => typeof value === "string")
      : [];
    if (!responseTypes.includes("code")) {
      throw new Error("Client metadata must allow code response type.");
    }

    const tokenEndpointAuthMethod = metadata.token_endpoint_auth_method;
    if (
      tokenEndpointAuthMethod !== undefined &&
      tokenEndpointAuthMethod !== null &&
      tokenEndpointAuthMethod !== "none"
    ) {
      throw new Error("Only token_endpoint_auth_method 'none' is supported.");
    }
  }
}

function parseScopes(rawScope: string | undefined): string[] {
  if (!rawScope) {
    return [DEFAULT_SCOPE];
  }
  const scopes = rawScope
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return scopes.length > 0 ? scopes : [DEFAULT_SCOPE];
}

function readRequiredString(body: Record<string, unknown>, key: string): string {
  const value = readOptionalString(body, key);
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function readOptionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildPkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
}

function buildRedirectUrl(redirectUri: string, code: string, state: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);
  return url.toString();
}

function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function extractNonce(challenge: string): string {
  const match = NONCE_REGEX.exec(challenge);
  if (!match?.[1]) {
    throw new Error("Challenge nonce not found.");
  }
  return match[1];
}

function writeJsonAtomic(path: string, data: unknown): void {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  renameSync(tempPath, path);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isAllowedClientMetadataUrl(url: URL): boolean {
  if (url.protocol === "https:") {
    return true;
  }

  if (
    process.env.NODE_ENV === "development" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  ) {
    return true;
  }

  return false;
}
