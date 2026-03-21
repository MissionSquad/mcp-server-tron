import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock fns
// ---------------------------------------------------------------------------

const mockResolveWalletProvider = vi.fn();
const mockSignTransaction = vi.fn();
const mockSignMessage = vi.fn();
const mockSignTypedData = vi.fn();
const mockGetActive = vi.fn();
const mockGetActiveId = vi.fn();
const mockSetActive = vi.fn();
const mockListWallets = vi.fn();
const mockGetWallet = vi.fn();
const mockTrxSign = vi.fn();
const mockSendRawTransaction = vi.fn();

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@bankofai/agent-wallet", () => ({
  resolveWalletProvider: mockResolveWalletProvider,
}));

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
      },
    },
  };

  return {
    default: MockTronWeb,
    TronWeb: MockTronWeb,
  };
});

vi.mock("../../../src/core/services/clients.js", () => ({
  getTronWeb: vi.fn(() => ({
    trx: {
      sign: mockTrxSign,
      sendRawTransaction: mockSendRawTransaction,
    },
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AW = typeof import("../../../src/core/services/agent-wallet.js");

async function freshImport(): Promise<AW> {
  vi.resetModules();
  return (await import("../../../src/core/services/agent-wallet.js")) as AW;
}

function createMockWallet(address: string, overrides: Record<string, unknown> = {}) {
  return {
    getAddress: vi.fn().mockResolvedValue(address),
    signTransaction: mockSignTransaction,
    signMessage: mockSignMessage,
    signTypedData: mockSignTypedData,
    ...overrides,
  };
}

function createProvider(overrides: Record<string, unknown> = {}) {
  return {
    getActiveWallet: mockGetActive,
    getActiveId: mockGetActiveId,
    setActive: mockSetActive,
    listWallets: mockListWallets,
    getWallet: mockGetWallet,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agent-wallet service", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe("getActiveWalletId", () => {
    it("returns null when resolveWalletProvider throws", async () => {
      mockResolveWalletProvider.mockImplementation(() => {
        throw new Error("no wallet");
      });
      const { getActiveWalletId } = await freshImport();
      expect(getActiveWalletId()).toBe(null);
      expect(mockResolveWalletProvider).toHaveBeenCalledWith({ network: "tron" });
    });

    it("returns active wallet ID from provider", async () => {
      mockResolveWalletProvider.mockReturnValue(createProvider({ getActiveId: mockGetActiveId }));
      mockGetActiveId.mockReturnValue("wallet-1");
      const { getActiveWalletId } = await freshImport();
      expect(getActiveWalletId()).toBe("wallet-1");
    });

    it("returns default when provider has no getActiveId", async () => {
      mockResolveWalletProvider.mockReturnValue(createProvider({ getActiveId: undefined }));
      const { getActiveWalletId } = await freshImport();
      expect(getActiveWalletId()).toBe("default");
    });
  });

  describe("getActiveWallet", () => {
    it("throws when no provider is available", async () => {
      mockResolveWalletProvider.mockImplementation(() => {
        throw new Error("no wallet");
      });
      const { getActiveWallet } = await freshImport();
      await expect(getActiveWallet()).rejects.toThrow("Wallet not configured.");
    });

    it("returns the active wallet from provider", async () => {
      const wallet = createMockWallet("TActiveAddr");
      mockResolveWalletProvider.mockReturnValue(createProvider({ getActiveWallet: mockGetActive }));
      mockGetActive.mockResolvedValue(wallet);
      const { getActiveWallet } = await freshImport();

      const result = await getActiveWallet();
      expect(result).toBe(wallet);
      expect(mockGetActive).toHaveBeenCalledTimes(1);
    });
  });

  describe("getOwnerAddress", () => {
    it("returns the active wallet address", async () => {
      const wallet = createMockWallet("TOwnerAddr");
      mockResolveWalletProvider.mockReturnValue(createProvider({ getActiveWallet: mockGetActive }));
      mockGetActive.mockResolvedValue(wallet);

      const { getOwnerAddress } = await freshImport();
      await expect(getOwnerAddress()).resolves.toBe("TOwnerAddr");
    });
  });

  describe("selectWallet", () => {
    it("throws when provider does not support setActive", async () => {
      mockResolveWalletProvider.mockReturnValue(createProvider({ setActive: undefined }));
      const { selectWallet } = await freshImport();
      await expect(selectWallet("wallet-1")).rejects.toThrow("select_wallet is not available.");
    });

    it("switches wallet and returns its address", async () => {
      const wallet = createMockWallet("TSwitchedAddr");
      mockResolveWalletProvider.mockReturnValue(createProvider({ getWallet: mockGetWallet }));
      mockGetWallet.mockResolvedValue(wallet);

      const { selectWallet } = await freshImport();
      await expect(selectWallet("wallet-2")).resolves.toEqual({
        id: "wallet-2",
        address: "TSwitchedAddr",
      });
      expect(mockSetActive).toHaveBeenCalledWith("wallet-2");
    });
  });

  describe("listAgentWallets", () => {
    it("returns a single wallet when provider has no listWallets", async () => {
      const wallet = createMockWallet("TSingleAddr");
      mockResolveWalletProvider.mockReturnValue(
        createProvider({ getActiveWallet: mockGetActive, listWallets: undefined }),
      );
      mockGetActive.mockResolvedValue(wallet);

      const { listAgentWallets } = await freshImport();
      await expect(listAgentWallets()).resolves.toEqual([
        { id: "default", type: "single", address: "TSingleAddr" },
      ]);
    });

    it("returns all wallets from provider when listWallets exists", async () => {
      const wallet1 = createMockWallet("TAddr1");
      const wallet2 = createMockWallet("TAddr2");
      mockResolveWalletProvider.mockReturnValue(createProvider({ listWallets: mockListWallets }));
      mockListWallets.mockResolvedValue([
        { id: "w1", type: "tron_local", chain_id: "tron:mainnet" },
        { id: "w2", type: "tron_local", chain_id: "tron:nile" },
      ]);
      mockGetWallet.mockResolvedValueOnce(wallet1).mockResolvedValueOnce(wallet2);

      const { listAgentWallets } = await freshImport();
      await expect(listAgentWallets()).resolves.toEqual([
        { id: "w1", type: "tron_local", address: "TAddr1" },
        { id: "w2", type: "tron_local", address: "TAddr2" },
      ]);
    });
  });

  describe("signing", () => {
    const unsignedTx = { txID: "abc123", raw_data: {}, raw_data_hex: "0a0208" };

    it("signTransaction uses the active wallet", async () => {
      const wallet = createMockWallet("TAddr");
      mockResolveWalletProvider.mockReturnValue(createProvider({ getActiveWallet: mockGetActive }));
      mockGetActive.mockResolvedValue(wallet);
      mockSignTransaction.mockResolvedValue(JSON.stringify({ ...unsignedTx, signature: ["sig"] }));

      const { signTransaction } = await freshImport();
      await expect(signTransaction(unsignedTx)).resolves.toEqual({
        ...unsignedTx,
        signature: ["sig"],
      });
    });

    it("signTransactionRaw uses the active wallet", async () => {
      const wallet = createMockWallet("TAddr");
      mockResolveWalletProvider.mockReturnValue(createProvider({ getActiveWallet: mockGetActive }));
      mockGetActive.mockResolvedValue(wallet);
      mockSignTransaction.mockResolvedValue(JSON.stringify({ ...unsignedTx, signature: ["sig"] }));

      const { signTransactionRaw } = await freshImport();
      await expect(signTransactionRaw(unsignedTx, "nile")).resolves.toEqual({
        ...unsignedTx,
        signature: ["sig"],
      });
    });

    it("buildSignBroadcast signs and broadcasts", async () => {
      const wallet = createMockWallet("TAddr");
      mockResolveWalletProvider.mockReturnValue(createProvider({ getActiveWallet: mockGetActive }));
      mockGetActive.mockResolvedValue(wallet);
      mockSignTransaction.mockResolvedValue(JSON.stringify({ ...unsignedTx, signature: ["sig"] }));
      mockSendRawTransaction.mockResolvedValue({ result: true, txid: "bcast-tx-id" });

      const { buildSignBroadcast } = await freshImport();
      await expect(buildSignBroadcast(unsignedTx, "nile")).resolves.toBe("bcast-tx-id");
    });

    it("signMessageWithWallet uses the active wallet", async () => {
      const wallet = createMockWallet("TAddr");
      mockResolveWalletProvider.mockReturnValue(createProvider({ getActiveWallet: mockGetActive }));
      mockGetActive.mockResolvedValue(wallet);
      mockSignMessage.mockResolvedValue("0xsig");

      const { signMessageWithWallet } = await freshImport();
      await expect(signMessageWithWallet("hello")).resolves.toBe("0xsig");
      expect(mockSignMessage).toHaveBeenCalledWith(Buffer.from("hello", "utf-8"));
    });

    it("signTypedDataWithWallet uses the active wallet", async () => {
      const wallet = createMockWallet("TAddr");
      mockResolveWalletProvider.mockReturnValue(createProvider({ getActiveWallet: mockGetActive }));
      mockGetActive.mockResolvedValue(wallet);
      mockSignTypedData.mockResolvedValue("0xtyped-sig");

      const { signTypedDataWithWallet } = await freshImport();
      await expect(
        signTypedDataWithWallet({ name: "Test" }, { Test: [] }, { value: 1 }),
      ).resolves.toBe("0xtyped-sig");
    });

    it("throws when wallet does not support signTypedData", async () => {
      const walletWithoutEip712 = createMockWallet("TAddr", {
        signTypedData: undefined,
      });
      mockResolveWalletProvider.mockReturnValue(createProvider({ getActiveWallet: mockGetActive }));
      mockGetActive.mockResolvedValue(walletWithoutEip712);

      const { signTypedDataWithWallet } = await freshImport();
      await expect(
        signTypedDataWithWallet({ name: "Test" }, { Test: [] }, { value: 1 }),
      ).rejects.toThrow("does not support signTypedData");
    });
  });

  describe("generateAccountKeypair", () => {
    it("returns an ephemeral account", async () => {
      const { generateAccountKeypair } = await freshImport();
      const result = await generateAccountKeypair();
      expect(result.address).toBe("TNewGeneratedAddress");
      expect(result.privateKey).toBeDefined();
    });
  });
});
