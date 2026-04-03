import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TenantManager } from "../../src/tenant/TenantManager.js";

describe("TenantManager", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "tron-tenant-manager-"));
    process.env.AGENT_WALLET_TEST_SCRYPT_N = "2048";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_WALLET_TEST_SCRYPT_N;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates and persists a tenant-backed managed wallet", async () => {
    const manager = new TenantManager({
      dataDir,
      tenantMasterSecret: "test-master-secret",
    });

    const created = await manager.createTenantWithNewWallet();

    expect(created.tenant.tenantId).toBe(created.tenant.walletAddressHex);
    expect(created.tenant.walletDir).toContain(created.tenant.tenantId);
    expect(created.wallet.address).toBe(created.tenant.walletAddressBase58);
    expect(created.wallet.addressHex).toBe(created.tenant.walletAddressHex);
    expect(created.wallet.privateKey.length).toBeGreaterThan(0);

    expect(existsSync(join(dataDir, "tenants", "index.json"))).toBe(true);
    expect(existsSync(join(dataDir, "tenants", created.tenant.tenantId, "tenant.json"))).toBe(true);
    expect(existsSync(join(created.tenant.walletDir, "wallets_config.json"))).toBe(true);
    expect(existsSync(join(created.tenant.walletDir, "master.json"))).toBe(true);

    const reloaded = manager.requireTenantByAddress(created.tenant.walletAddressBase58);
    expect(reloaded.tenantId).toBe(created.tenant.tenantId);
  });

  it("increments sessionVersion and persists the update", async () => {
    const manager = new TenantManager({
      dataDir,
      tenantMasterSecret: "test-master-secret",
    });
    const created = await manager.createTenantWithNewWallet();

    const updated = manager.incrementSessionVersion(created.tenant.tenantId);
    expect(updated.sessionVersion).toBe(created.tenant.sessionVersion + 1);

    const persisted = JSON.parse(
      readFileSync(join(dataDir, "tenants", created.tenant.tenantId, "tenant.json"), "utf-8"),
    ) as { sessionVersion: number };
    expect(persisted.sessionVersion).toBe(updated.sessionVersion);
  });
});
