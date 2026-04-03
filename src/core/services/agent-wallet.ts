/**
 * Agent-wallet integration layer for mcp-server-tron.
 *
 * Provides a unified signing interface via agent-wallet SDK.
 */

import {
  TenantWalletProvider,
  type WalletProvider,
  resolveWalletProvider,
  type Wallet,
  type Eip712Capable,
} from "@missionsquad/agent-wallet";
import { TronWeb } from "tronweb";
import { getTronWeb } from "./clients.js";
import { getRequestContext } from "../../tenant/context.js";
import type { TenantRecord } from "../../tenant/types.js";

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let provider: WalletProvider | null = null;
let activeWallet: Wallet | null = null;
let activeAddress: string | null = null;

type WalletRuntime =
  | {
      mode: "tenant";
      tenant: TenantRecord;
      provider: TenantWalletProvider;
    }
  | {
      mode: "legacy";
      provider: WalletProvider | null;
    };

// ---------------------------------------------------------------------------
function getProvider(): WalletProvider | null {
  if (provider) return provider;

  try {
    provider = resolveWalletProvider({ network: "tron" });
    return provider;
  } catch (_e) {
    // Config missing or invalid - SDK throws ValueError
    return null;
  }
}

function getRuntime(): WalletRuntime {
  const context = getRequestContext();
  if (context?.auth) {
    return {
      mode: "tenant",
      tenant: context.auth.tenant,
      provider: context.tenantManager.getTenantWalletProvider(context.auth.tenant.tenantId),
    };
  }

  return {
    mode: "legacy",
    provider: getProvider(),
  };
}

// ---------------------------------------------------------------------------
// Active wallet management
// ---------------------------------------------------------------------------

/**
 * Get the currently active agent-wallet.
 */
export async function getActiveWallet(): Promise<Wallet> {
  const runtime = getRuntime();
  if (runtime.mode === "tenant") {
    return runtime.provider.getPrimaryWallet();
  }

  if (activeWallet) return activeWallet;
  if (!runtime.provider) {
    throw new Error("Wallet not configured.");
  }

  activeWallet = await runtime.provider.getActiveWallet();
  activeAddress = await activeWallet.getAddress();
  return activeWallet;
}

/**
 * Get the address of the active wallet.
 */
export async function getOwnerAddress(): Promise<string> {
  const runtime = getRuntime();
  if (runtime.mode === "tenant") {
    return runtime.tenant.walletAddressBase58;
  }

  if (activeAddress) return activeAddress;
  await getActiveWallet();
  if (activeAddress == null) {
    throw new Error("Failed to resolve active wallet address");
  }
  return activeAddress;
}

/**
 * Switch the active wallet at runtime when the provider supports multi-wallet selection.
 */
export async function selectWallet(walletId: string): Promise<{ id: string; address: string }> {
  const runtime = getRuntime();
  if (runtime.mode === "tenant") {
    throw new Error("select_wallet is not available in HTTP tenant mode.");
  }

  const p = runtime.provider;
  if (!p || typeof (p as any).setActive !== "function") {
    throw new Error("select_wallet is not available.");
  }

  const lp = p as any;
  lp.setActive(walletId);
  const wallet = await lp.getWallet(walletId);
  const address = await wallet.getAddress();

  // Update cached state
  activeWallet = wallet;
  activeAddress = address;

  return { id: walletId, address };
}

/**
 * List all available wallets.
 */
export async function listAgentWallets(): Promise<
  Array<{ id: string; type: string; address: string }>
> {
  const runtime = getRuntime();
  if (runtime.mode === "tenant") {
    return [
      {
        id: "primary",
        type: "local_secure",
        address: runtime.tenant.walletAddressBase58,
      },
    ];
  }

  const p = runtime.provider;
  if (!p) return [];

  if (typeof (p as any).listWallets === "function") {
    const lp = p as any;
    // agent-wallet@2.3+: listWallets(): Array<[walletId, walletConfig, isActive]>
    // agent-wallet@2.2 (and tests) may return Promise<Array<{id,type,...}>>.
    const wallets = await lp.listWallets();
    const result: Array<{ id: string; type: string; address: string }> = [];

    for (const w of wallets) {
      let walletId: string;
      let walletType: string;

      if (Array.isArray(w)) {
        walletId = w[0] as string;
        walletType = ((w[1] as { type?: string })?.type ?? "unknown") as string;
      } else {
        walletId = (w as { id?: string }).id ?? "";
        walletType = ((w as { type?: string }).type ?? "unknown") as string;
      }

      if (!walletId) {
        // Skip malformed entries so one bad import does not hide all wallets.
        continue;
      }

      const wallet = await lp.getWallet(walletId);
      const address = await wallet.getAddress();
      result.push({ id: walletId, type: walletType, address });
    }
    return result;
  }

  // Single-wallet mode
  const wallet = await p.getActiveWallet();
  const address = await wallet.getAddress();
  if (address == null) {
    return [];
  }
  return [{ id: "single", type: "single", address }];
}

/**
 * Get the currently active wallet ID.
 */
export function getActiveWalletId(): string | null {
  const runtime = getRuntime();
  if (runtime.mode === "tenant") {
    return "primary";
  }

  const p = runtime.provider;
  if (!p) return null;

  if (typeof (p as any).getActiveId === "function") {
    return (p as any).getActiveId();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Sign an unsigned transaction.
 */
export async function signTransaction(unsignedTx: Record<string, unknown>): Promise<any> {
  const wallet = await getActiveWallet();
  const signedJson = await wallet.signTransaction(unsignedTx);
  return JSON.parse(signedJson);
}

/**
 * Sign using raw crypto.
 */
export async function signTransactionRaw(
  unsignedTx: Record<string, unknown>,
  _network = "mainnet",
): Promise<any> {
  const wallet = await getActiveWallet();
  const signedJson = await wallet.signTransaction(unsignedTx);
  return JSON.parse(signedJson);
}

/**
 * Sign an unsigned transaction and broadcast it.
 */
export async function buildSignBroadcast(
  unsignedTx: Record<string, unknown>,
  network = "mainnet",
): Promise<string> {
  const signedTx = await signTransaction(unsignedTx);
  const tronWeb = getTronWeb(network);
  const result = await tronWeb.trx.sendRawTransaction(signedTx as any);

  if (result.result) {
    return result.txid;
  }
  throw new Error(`Broadcast failed: ${JSON.stringify(result)}`);
}

/**
 * Sign a message using the active wallet.
 */
export async function signMessageWithWallet(message: string): Promise<string> {
  const wallet = await getActiveWallet();
  const msgBytes = Buffer.from(message, "utf-8");
  return await wallet.signMessage(msgBytes);
}

/**
 * Sign typed data (EIP-712) using the active wallet.
 */
export async function signTypedDataWithWallet(
  domain: object,
  types: object,
  value: object,
): Promise<string> {
  const wallet = await getActiveWallet();
  const eip712Wallet = wallet as unknown as Eip712Capable;
  if (typeof eip712Wallet.signTypedData !== "function") {
    throw new Error("Active wallet does not support signTypedData");
  }
  return await eip712Wallet.signTypedData({ domain, types, value } as any);
}

// ---------------------------------------------------------------------------
// Account generation
// ---------------------------------------------------------------------------

/**
 * Unified account generation.
 * Generates a keypair and returns it directly. It is NOT stored in agent-wallet.
 */
export async function generateAccountKeypair(): Promise<{
  address: string;
  privateKey: string;
  message: string;
}> {
  // Generate keypair via TronWeb
  const account = await TronWeb.createAccount();

  return {
    address: account.address.base58,
    privateKey: account.privateKey,
    message:
      "Account generated successfully. Note: This account is NOT stored. Please save your private key manually.",
  };
}
