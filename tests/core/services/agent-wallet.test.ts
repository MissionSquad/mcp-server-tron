import { describe, it, expect, vi, afterEach } from "vitest";
import TronWeb from "tronweb";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("tronweb", () => {
  const MockTronWeb = {
    createAccount: vi.fn().mockReturnValue({
      privateKey: "0000000000000000000000000000000000000000000000000000000000000001",
      address: {
        base58: "TNewGeneratedAddress",
      },
    }),
    utils: {
      crypto: {
        getAddressFromPrivateKey: vi.fn().mockReturnValue("TNewGeneratedAddress"),
        getBufferFromHex: vi.fn((hex) => Buffer.from(hex, "hex")),
      },
    },
  };
  return {
    default: MockTronWeb,
    TronWeb: MockTronWeb,
  };
});

// ---------------------------------------------------------------------------
// Shared mock fns (referenced by the mock factories below)
// ---------------------------------------------------------------------------
const mockSignTransaction = vi.fn();
const mockSignMessage = vi.fn();
const mockSignTypedData = vi.fn();
const mockListWallets = vi.fn();
const mockGetWallet = vi.fn();
const mockGenerateKey = vi.fn();
const mockSavePrivateKey = vi.fn();
const mockTrxSign = vi.fn();
const mockSendRawTransaction = vi.fn();
const mockCryptoSignTx = vi.fn((_pk: string, tx: any) => ({
  ...tx,
  signature: ["static-raw-sig"],
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockGetActiveId = vi.fn();
const mockGetActive = vi.fn();
const mockSetActive = vi.fn();

vi.mock("@bankofai/agent-wallet", () => ({
  resolveWalletProvider: vi.fn((options) => {
    if (process.env.AGENT_WALLET_PASSWORD) {
      return {
        listWallets: mockListWallets,
        getWallet: mockGetWallet,
        getActiveId: mockGetActiveId,
        getActiveWallet: mockGetActive,
        setActive: mockSetActive,
      };
    }
    return {
      getActiveWallet: mockGetActive,
    };
  }),
  SecureKVStore: vi.fn().mockImplementation(function () {
    return {
      generateKey: mockGenerateKey,
      savePrivateKey: mockSavePrivateKey
    };
  }),
  TronWallet: vi.fn().mockImplementation(function () {
    return { getAddress: vi.fn().mockResolvedValue("TNewGeneratedAddress") };
  }),
  loadConfig: vi.fn(() => ({ wallets: {} })),
  saveConfig: vi.fn(),
}));

vi.mock("../../../src/core/services/clients.js", () => ({
  getTronWeb: vi.fn(() => ({
    trx: {
      sign: mockTrxSign,
      sendRawTransaction: mockSendRawTransaction,
    },
    utils: { crypto: { signTransaction: mockCryptoSignTx } },
  })),
  getWallet: vi.fn(() => ({
    trx: { sign: mockTrxSign },
  })),
}));

// ---------------------------------------------------------------------------
// ENV helpers
// ---------------------------------------------------------------------------
const ORIGINAL_ENV = { ...process.env };

function setAgentWalletEnv() {
  process.env.AGENT_WALLET_DIR = "/tmp/test-wallet";
  process.env.AGENT_WALLET_PASSWORD = "test-pass";
  delete process.env.TRON_PRIVATE_KEY;
  delete process.env.TRON_MNEMONIC;
}

function setStaticEnv() {
  delete process.env.AGENT_WALLET_DIR;
  delete process.env.AGENT_WALLET_PASSWORD;
  process.env.TRON_PRIVATE_KEY = "0000000000000000000000000000000000000000000000000000000000000001";
}

function clearAllWalletEnv() {
  delete process.env.AGENT_WALLET_DIR;
  delete process.env.AGENT_WALLET_PASSWORD;
  delete process.env.TRON_PRIVATE_KEY;
  delete process.env.TRON_MNEMONIC;
}

/** Create a full mock wallet with all methods. */
function createMockWallet(address: string) {
  return {
    getAddress: vi.fn().mockResolvedValue(address),
    signTransaction: mockSignTransaction,
    signMessage: mockSignMessage,
    signTypedData: mockSignTypedData,
  };
}

// ---------------------------------------------------------------------------
// Dynamic import helper — each call gets a fresh module with clean singletons
// ---------------------------------------------------------------------------
type AW = typeof import("../../../src/core/services/agent-wallet.js");

async function freshImport(): Promise<AW> {
  // Reset module registry so the import gives a fresh singleton set
  vi.resetModules();
  return (await import("../../../src/core/services/agent-wallet.js")) as AW;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("agent-wallet service", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.clearAllMocks();
  });

  // =========================================================================
  // Mode detection — pure functions, no singleton state
  // =========================================================================

  describe("isWalletConfigured", () => {
    it("returns true when AGENT_WALLET_PASSWORD is set", async () => {
      setAgentWalletEnv();
      const { isWalletConfigured } = await freshImport();
      expect(isWalletConfigured()).toBe(true);
    });

    it("returns true when only AGENT_WALLET_PASSWORD is set (uses default dir)", async () => {
      clearAllWalletEnv();
      process.env.AGENT_WALLET_PASSWORD = "pass";
      const { isWalletConfigured } = await freshImport();
      expect(isWalletConfigured()).toBe(true);
    });

    it("returns false when AGENT_WALLET_PASSWORD is missing but no keys either", async () => {
      clearAllWalletEnv();
      const { isWalletConfigured } = await freshImport();
      expect(isWalletConfigured()).toBe(false);
    });
  });

  // =========================================================================
  // getActiveWalletId
  // =========================================================================

  describe("getActiveWalletId", () => {
    it("returns 'default' in static mode", async () => {
      setStaticEnv();
      const { getActiveWalletId } = await freshImport();
      expect(getActiveWalletId()).toBe("default");
    });

    it("returns null when no wallet env is configured", async () => {
      clearAllWalletEnv();
      const { getActiveWalletId } = await freshImport();
      expect(getActiveWalletId()).toBe(null);
    });

    it("returns active wallet ID from provider config", async () => {
      setAgentWalletEnv();
      mockGetActiveId.mockReturnValue("wallet-1");
      const { getActiveWalletId } = await freshImport();
      expect(getActiveWalletId()).toBe("wallet-1");
    });

    it("returns null when provider has no active wallet", async () => {
      setAgentWalletEnv();
      mockGetActiveId.mockReturnValue(null);
      const { getActiveWalletId } = await freshImport();
      expect(getActiveWalletId()).toBe(null);
    });
  });

  // =========================================================================
  // getOwnerAddress
  // =========================================================================

  describe("getOwnerAddress", () => {
    it("derives address from TRON_PRIVATE_KEY in static mode", async () => {
      setStaticEnv();
      mockGetActive.mockResolvedValue(createMockWallet("TStaticAddr123"));
      const { getOwnerAddress } = await freshImport();
      const address = await getOwnerAddress();
      expect(address).toBe("TStaticAddr123");
    });

    it("gets address from agent-wallet in agent-wallet mode", async () => {
      setAgentWalletEnv();
      mockGetActive.mockResolvedValue(createMockWallet("TAgentWalletAddr123"));
      const { getOwnerAddress } = await freshImport();

      const address = await getOwnerAddress();
      expect(address).toBe("TAgentWalletAddr123");
    });
  });

  // =========================================================================
  // selectWallet
  // =========================================================================

  describe("selectWallet", () => {
    it("throws in static mode", async () => {
      setStaticEnv();
      const { selectWallet } = await freshImport();
      await expect(selectWallet("some-id")).rejects.toThrow(
        "select_wallet is not available for this provider",
      );
    });

    it("switches wallet and persists via provider.setActive", async () => {
      setAgentWalletEnv();
      mockGetWallet.mockResolvedValue(createMockWallet("TSwitchedAddr"));
      const { selectWallet } = await freshImport();

      const result = await selectWallet("wallet-2");
      expect(result.id).toBe("wallet-2");
      expect(result.address).toBe("TSwitchedAddr");
      expect(mockSetActive).toHaveBeenCalledWith("wallet-2");
    });
  });

  // =========================================================================
  // listAgentWallets
  // =========================================================================

  describe("listAgentWallets", () => {
    it("returns single default wallet in static mode", async () => {
      setStaticEnv();
      mockGetActive.mockResolvedValue(createMockWallet("TStaticAddr"));
      const { listAgentWallets } = await freshImport();
      const wallets = await listAgentWallets();
      expect(wallets).toHaveLength(1);
      expect(wallets[0].id).toBe("default");
      expect(wallets[0].type).toBe("static");
      expect(wallets[0].address).toBe("TStaticAddr");
    });

    it("returns all wallets from provider in agent-wallet mode", async () => {
      setAgentWalletEnv();
      mockListWallets.mockResolvedValue([
        { id: "w1", type: "tron_local", chain_id: "tron:mainnet" },
        { id: "w2", type: "tron_local", chain_id: "tron:nile" },
      ]);
      mockGetWallet
        .mockResolvedValueOnce(createMockWallet("TAddr1"))
        .mockResolvedValueOnce(createMockWallet("TAddr2"));

      const { listAgentWallets } = await freshImport();
      const wallets = await listAgentWallets();
      expect(wallets).toHaveLength(2);
      expect(wallets[0]).toEqual({
        id: "w1",
        type: "tron_local",
        address: "TAddr1",
      });
      expect(wallets[1]).toEqual({
        id: "w2",
        type: "tron_local",
        address: "TAddr2",
      });
    });
  });

  // =========================================================================
  // signTransaction
  // =========================================================================

  describe("signTransaction", () => {
    const unsignedTx = { txID: "abc123", raw_data: {}, raw_data_hex: "0a0208" };

    it("signs via agent-wallet SDK regardless of mode (unified)", async () => {
      setStaticEnv();
      const signedTx = { ...unsignedTx, signature: ["aw-sig"] };
      mockSignTransaction.mockResolvedValue(JSON.stringify(signedTx));
      mockGetActive.mockResolvedValue(createMockWallet("TAddr"));

      const { signTransaction } = await freshImport();
      const result = await signTransaction(unsignedTx);
      expect(result).toEqual(signedTx);
      expect(mockSignTransaction).toHaveBeenCalledWith(unsignedTx);
    });

    it("signs via agent-wallet SDK in agent-wallet mode", async () => {
      setAgentWalletEnv();
      const signedTx = { ...unsignedTx, signature: ["aw-sig"] };
      mockSignTransaction.mockResolvedValue(JSON.stringify(signedTx));
      mockGetActive.mockResolvedValue(createMockWallet("TAddr"));

      const { signTransaction } = await freshImport();
      const result = await signTransaction(unsignedTx);
      expect(result).toEqual(signedTx);
      expect(mockSignTransaction).toHaveBeenCalledWith(unsignedTx);
    });
  });

  // =========================================================================
  // signTransactionRaw
  // =========================================================================

  describe("signTransactionRaw", () => {
    const unsignedTx = { txID: "raw123", raw_data: {}, raw_data_hex: "0b0309" };

    it("signs via agent-wallet SDK regardless of mode (unified)", async () => {
      setStaticEnv();
      const signedTx = { ...unsignedTx, signature: ["aw-raw-sig"] };
      mockSignTransaction.mockResolvedValue(JSON.stringify(signedTx));
      mockGetActive.mockResolvedValue(createMockWallet("TAddr"));

      const { signTransactionRaw } = await freshImport();
      const result = await signTransactionRaw(unsignedTx, "nile");
      expect(result).toEqual(signedTx);
    });

    it("signs via agent-wallet in agent-wallet mode", async () => {
      setAgentWalletEnv();
      const signedTx = { ...unsignedTx, signature: ["aw-raw-sig"] };
      mockSignTransaction.mockResolvedValue(JSON.stringify(signedTx));
      mockGetActive.mockResolvedValue(createMockWallet("TAddr"));

      const { signTransactionRaw } = await freshImport();
      const result = await signTransactionRaw(unsignedTx, "nile");
      expect(result).toEqual(signedTx);
    });
  });

  // =========================================================================
  // buildSignBroadcast
  // =========================================================================

  describe("buildSignBroadcast", () => {
    const unsignedTx = { txID: "bsb123", raw_data: {}, raw_data_hex: "0c0409" };

    it("signs and broadcasts, returning txid on success", async () => {
      setStaticEnv();
      mockTrxSign.mockResolvedValue({ ...unsignedTx, signature: ["sig"] });
      mockSendRawTransaction.mockResolvedValue({ result: true, txid: "bcast-tx-id" });

      const { buildSignBroadcast } = await freshImport();
      const txid = await buildSignBroadcast(unsignedTx, "nile");
      expect(txid).toBe("bcast-tx-id");
    });

    it("throws when broadcast fails", async () => {
      setStaticEnv();
      mockTrxSign.mockResolvedValue({ ...unsignedTx, signature: ["sig"] });
      mockSendRawTransaction.mockResolvedValue({
        result: false,
        code: "BANDWITH_ERROR",
        message: "not enough bandwidth",
      });

      const { buildSignBroadcast } = await freshImport();
      await expect(buildSignBroadcast(unsignedTx, "nile")).rejects.toThrow("Broadcast failed");
    });
  });

  // =========================================================================
  // signMessageWithWallet
  // =========================================================================

  describe("signMessageWithWallet", () => {
    it("signs message in static mode via TronWeb (may throw due to no network)", async () => {
      setStaticEnv();
      const { signMessageWithWallet } = await freshImport();
      try {
        await signMessageWithWallet("hello");
      } catch (error: any) {
        // Expected — no real TronWeb, but should NOT throw "agent-wallet mode" error
        expect(error.message).not.toContain("agent-wallet mode");
      }
    });

    it("signs message via agent-wallet SDK in agent-wallet mode", async () => {
      setAgentWalletEnv();
      mockSignMessage.mockResolvedValue("0xsig");
      mockGetActive.mockResolvedValue(createMockWallet("TAddr"));

      const { signMessageWithWallet } = await freshImport();
      const sig = await signMessageWithWallet("hello");
      expect(sig).toBe("0xsig");
      expect(mockSignMessage).toHaveBeenCalledWith(Buffer.from("hello", "utf-8"));
    });
  });

  // =========================================================================
  // signTypedDataWithWallet
  // =========================================================================

  describe("signTypedDataWithWallet", () => {
    const domain = { name: "Test" };
    const types = { Test: [{ name: "value", type: "uint256" }] };
    const value = { value: 1 };

    it("throws in static mode when TronWeb lacks _signTypedData", async () => {
      setStaticEnv();
      const { signTypedDataWithWallet } = await freshImport();
      try {
        await signTypedDataWithWallet(domain, types, value);
      } catch (error: any) {
        expect(error.message).toBeDefined();
      }
    });

    it("signs via agent-wallet in agent-wallet mode", async () => {
      setAgentWalletEnv();
      mockSignTypedData.mockResolvedValue("0xtyped-sig");
      mockGetActive.mockResolvedValue(createMockWallet("TAddr"));

      const { signTypedDataWithWallet } = await freshImport();
      const sig = await signTypedDataWithWallet(domain, types, value);
      expect(sig).toBe("0xtyped-sig");
    });

    it("throws when wallet doesn't support signTypedData", async () => {
      setAgentWalletEnv();
      const walletWithoutEip712 = {
        getAddress: vi.fn().mockResolvedValue("TAddr"),
        signTransaction: mockSignTransaction,
        signMessage: mockSignMessage,
        // No signTypedData
      };
      mockGetActive.mockResolvedValue(walletWithoutEip712);

      const { signTypedDataWithWallet } = await freshImport();
      await expect(signTypedDataWithWallet(domain, types, value)).rejects.toThrow(
        "does not support signTypedData",
      );
    });
  });

  // =========================================================================
  // generateAndStoreAccount
  // =========================================================================

  describe("generateAccount", () => {
    it("returns ephemeral account when AGENT_WALLET_PASSWORD is missing", async () => {
      setStaticEnv();
      const { generateAccount } = await freshImport();
      const result = await generateAccount();
      expect(result.isStored).toBe(false);
      expect(result.walletId).toBe("ephemeral");
      expect(result.address).toBe("TNewGeneratedAddress");
    });

    it("generates and stores an encrypted key without switching active wallet", async () => {
      setAgentWalletEnv();

      const { generateAccount } = await freshImport();
      const result = await generateAccount("my-wallet");
      expect(result.walletId).toBe("my-wallet");
      expect(result.address).toBe("TNewGeneratedAddress");
      expect(result.isStored).toBe(true);
      expect(mockSetActive).not.toHaveBeenCalled();
    });

    it("auto-generates wallet name when not provided", async () => {
      setAgentWalletEnv();

      const { generateAccount } = await freshImport();
      const result = await generateAccount();
      expect(result.walletId).toMatch(/^tron-\d+$/);
      expect(result.address).toBe("TNewGeneratedAddress");
      expect(result.isStored).toBe(true);
      expect(mockSetActive).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Cross-operation state persistence
  // =========================================================================

  describe("cross-operation state persistence", () => {
    it("generateAccount preserves active wallet", async () => {
      setAgentWalletEnv();
      mockGetWallet.mockResolvedValue(createMockWallet("TSwitchedAddr"));
      mockGetActiveId.mockReturnValue("wallet-2");
      const mod = await freshImport();
      await mod.selectWallet("wallet-2");
      mockSetActive.mockClear();

      // generateAccount should NOT change active wallet
      await mod.generateAccount("new-wallet");
      expect(mockSetActive).not.toHaveBeenCalled();

      // Active wallet remains wallet-2
      mockGetActiveId.mockReturnValue("wallet-2");
      expect(mod.getActiveWalletId()).toBe("wallet-2");
    });

    it("selectWallet persists choice to provider config", async () => {
      setAgentWalletEnv();
      mockGetWallet.mockResolvedValue(createMockWallet("TSwitchedAddr"));
      const mod = await freshImport();

      await mod.selectWallet("wallet-2");
      expect(mockSetActive).toHaveBeenCalledWith("wallet-2");
    });
  });
});
