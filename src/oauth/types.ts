export interface PendingAuthorizationRequest {
  authRequestId: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string[];
  resource: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  issuedAt: number;
  expiresAt: number;
}

export interface ChallengeRecord {
  nonce: string;
  authRequestId: string;
  tenantId: string;
  walletAddressBase58: string;
  walletAddressHex: string;
  challenge: string;
  issuedAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export interface AuthorizationCodeRecord {
  code: string;
  clientId: string;
  redirectUri: string;
  tenantId: string;
  walletAddressBase58: string;
  walletId: "primary";
  scope: string[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  issuedAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export interface RefreshTokenRecord {
  tokenHash: string;
  tenantId: string;
  walletAddressBase58: string;
  walletId: "primary";
  clientId: string;
  scopes: string[];
  sessionVersion: number;
  createdAt: number;
  expiresAt: number;
  rotatedAt: number | null;
  revokedAt: number | null;
  replacedByTokenHash: string | null;
}

export interface OAuthAccessTokenPayload {
  sub: string;
  tenantId: string;
  walletId: "primary";
  walletAddress: string;
  clientId: string;
  scope: string;
  sessionVersion: number;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}
