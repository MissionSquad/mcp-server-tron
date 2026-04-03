import { createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TronWeb } from "tronweb";
import { TenantWalletProvider, type CreatedTenantWallet } from "@missionsquad/agent-wallet";
import type { TenantIndex, TenantRecord } from "./types.js";

const PRIMARY_WALLET_ID = "primary" as const;
const TENANTS_DIRNAME = "tenants";
const TENANT_INDEX_FILENAME = "index.json";
const TENANT_RECORD_FILENAME = "tenant.json";
const TENANT_WALLET_DIRNAME = "agent-wallet";

export interface TenantManagerOptions {
  dataDir: string;
  tenantMasterSecret: string;
}

export class TenantManager {
  private readonly dataDir: string;
  private readonly tenantMasterSecret: string;

  constructor(options: TenantManagerOptions) {
    this.dataDir = options.dataDir;
    this.tenantMasterSecret = options.tenantMasterSecret;
  }

  normalizeAddress(address: string): {
    walletAddressBase58: string;
    walletAddressHex: string;
    tenantId: string;
  } {
    if (!TronWeb.isAddress(address)) {
      throw new Error(`Invalid TRON address: ${address}`);
    }

    const walletAddressHex = TronWeb.address.toHex(address).toLowerCase().replace(/^0x/, "");
    const walletAddressBase58 = TronWeb.address.fromHex(walletAddressHex);

    return {
      walletAddressBase58,
      walletAddressHex,
      tenantId: walletAddressHex,
    };
  }

  getTenantIndex(): TenantIndex {
    this.ensureTenantsRoot();
    const indexPath = this.getIndexPath();
    if (!existsSync(indexPath)) {
      return {};
    }
    return JSON.parse(readFileSync(indexPath, "utf-8")) as TenantIndex;
  }

  getTenantById(tenantId: string): TenantRecord | null {
    const recordPath = this.getTenantRecordPath(tenantId);
    if (!existsSync(recordPath)) {
      return null;
    }
    return JSON.parse(readFileSync(recordPath, "utf-8")) as TenantRecord;
  }

  getTenantByAddress(address: string): TenantRecord | null {
    const { walletAddressHex } = this.normalizeAddress(address);
    const index = this.getTenantIndex();
    const tenantId = index[walletAddressHex];
    if (!tenantId) {
      return null;
    }
    return this.getTenantById(tenantId);
  }

  requireTenantByAddress(address: string): TenantRecord {
    const tenant = this.getTenantByAddress(address);
    if (!tenant) {
      throw new Error("Managed tenant wallet not found for the provided address.");
    }
    return tenant;
  }

  async createTenantWithNewWallet(): Promise<{
    tenant: TenantRecord;
    wallet: CreatedTenantWallet;
  }> {
    this.ensureTenantsRoot();

    const generatedAccount = await TronWeb.createAccount();
    const normalized = this.normalizeAddress(generatedAccount.address.base58);
    const existingTenant = this.getTenantById(normalized.tenantId);
    if (existingTenant) {
      throw new Error(`Tenant '${normalized.tenantId}' already exists.`);
    }

    const pendingRoot = join(this.getTenantsRoot(), `.pending-${randomUUID()}`);
    const pendingWalletDir = join(pendingRoot, TENANT_WALLET_DIRNAME);
    mkdirSync(pendingWalletDir, { recursive: true });

    const provider = new TenantWalletProvider({
      tenantId: normalized.tenantId,
      walletDir: pendingWalletDir,
      masterPassword: this.deriveTenantPassword(normalized.tenantId),
      network: "tron",
    });

    try {
      const wallet = await provider.createPrimaryTronWalletFromPrivateKey(
        generatedAccount.privateKey,
        normalized.walletAddressBase58,
      );

      const tenantRoot = this.getTenantRoot(normalized.tenantId);
      renameSync(pendingRoot, tenantRoot);

      const now = Date.now();
      const tenant: TenantRecord = {
        tenantId: normalized.tenantId,
        walletId: PRIMARY_WALLET_ID,
        walletAddressBase58: normalized.walletAddressBase58,
        walletAddressHex: normalized.walletAddressHex,
        walletDir: join(tenantRoot, TENANT_WALLET_DIRNAME),
        createdAt: now,
        updatedAt: now,
        sessionVersion: 1,
      };

      this.writeTenantRecord(tenant);

      const index = this.getTenantIndex();
      index[tenant.walletAddressHex] = tenant.tenantId;
      this.writeTenantIndex(index);

      return {
        tenant,
        wallet: {
          ...wallet,
          walletDir: tenant.walletDir,
          addressHex: tenant.walletAddressHex,
        },
      };
    } catch (error) {
      rmSync(pendingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  getTenantWalletProvider(tenantId: string): TenantWalletProvider {
    const tenant = this.getTenantById(tenantId);
    if (!tenant) {
      throw new Error(`Tenant '${tenantId}' not found.`);
    }

    return new TenantWalletProvider({
      tenantId: tenant.tenantId,
      walletDir: tenant.walletDir,
      masterPassword: this.deriveTenantPassword(tenant.tenantId),
      network: "tron",
    });
  }

  incrementSessionVersion(tenantId: string): TenantRecord {
    const tenant = this.getTenantById(tenantId);
    if (!tenant) {
      throw new Error(`Tenant '${tenantId}' not found.`);
    }

    const updated: TenantRecord = {
      ...tenant,
      sessionVersion: tenant.sessionVersion + 1,
      updatedAt: Date.now(),
    };
    this.writeTenantRecord(updated);
    return updated;
  }

  private deriveTenantPassword(tenantId: string): string {
    return createHmac("sha256", this.tenantMasterSecret).update(tenantId).digest("base64url");
  }

  private ensureTenantsRoot(): void {
    mkdirSync(this.getTenantsRoot(), { recursive: true });
  }

  private getTenantsRoot(): string {
    return join(this.dataDir, TENANTS_DIRNAME);
  }

  private getIndexPath(): string {
    return join(this.getTenantsRoot(), TENANT_INDEX_FILENAME);
  }

  private getTenantRoot(tenantId: string): string {
    return join(this.getTenantsRoot(), tenantId);
  }

  private getTenantRecordPath(tenantId: string): string {
    return join(this.getTenantRoot(tenantId), TENANT_RECORD_FILENAME);
  }

  private writeTenantIndex(index: TenantIndex): void {
    this.writeJsonAtomic(this.getIndexPath(), index);
  }

  private writeTenantRecord(record: TenantRecord): void {
    mkdirSync(this.getTenantRoot(record.tenantId), { recursive: true });
    this.writeJsonAtomic(this.getTenantRecordPath(record.tenantId), record);
  }

  private writeJsonAtomic(path: string, data: unknown): void {
    const tempPath = `${path}.tmp`;
    writeFileSync(tempPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    renameSync(tempPath, path);
  }
}
