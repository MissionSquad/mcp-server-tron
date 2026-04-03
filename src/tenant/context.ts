import { AsyncLocalStorage } from "node:async_hooks";
import type { TenantAuthContext } from "./types.js";
import type { TenantManager } from "./TenantManager.js";

export interface RequestContextState {
  transport: "http";
  tenantManager: TenantManager;
  auth: TenantAuthContext | null;
}

const requestContextStorage = new AsyncLocalStorage<RequestContextState>();

export function runWithRequestContext<T>(
  state: RequestContextState,
  fn: () => Promise<T>,
): Promise<T> {
  return requestContextStorage.run(state, fn);
}

export function getRequestContext(): RequestContextState | undefined {
  return requestContextStorage.getStore();
}

export function requireTenantAuthContext(): TenantAuthContext {
  const context = getRequestContext();
  if (!context?.auth) {
    throw new Error("Authentication required.");
  }
  return context.auth;
}

export function getTenantManagerFromContext(): TenantManager {
  const context = getRequestContext();
  if (!context) {
    throw new Error("Tenant request context is not available.");
  }
  return context.tenantManager;
}
