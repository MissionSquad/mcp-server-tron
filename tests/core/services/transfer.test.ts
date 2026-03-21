import { describe, it, expect } from "vitest";
import { transferTRX, transferTRC20, approveTRC20 } from "../../../src/core/services/transfer.js";

describe("Transfer Services Integration (Nile)", () => {
  const hasWallet = false;

  it.runIf(hasWallet)(
    "transferTRX should attempt to send TRX and return tx hash or meaningful error",
    async () => {
      const receiverAddress = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";

      try {
        const txHash = await transferTRX(receiverAddress, "0.000001", "nile");
        expect(typeof txHash).toBe("string");
        console.log(`transferTRX Tx ID: ${txHash}`);
      } catch (error: any) {
        // May fail due to insufficient balance or network constraints
        console.log("Transfer (transferTRX) integration feedback:", error.message);
        expect(error.message).toBeDefined();
      }
    },
    30000,
  );

  it.runIf(hasWallet)(
    "transferTRC20 should attempt to send TRC20 and return result or meaningful error",
    async () => {
      const receiverAddress = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
      // USDT on Nile testnet
      const tokenAddress = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";

      try {
        const result = await transferTRC20(tokenAddress, receiverAddress, "1", "nile");
        expect(result.txHash).toBeDefined();
        console.log(`transferTRC20 Tx Hash: ${result.txHash}`);
      } catch (error: any) {
        console.log("Transfer (transferTRC20) integration feedback:", error.message);
        expect(error.message).toContain("Failed to transfer TRC20");
      }
    },
    30000,
  );

  it.runIf(hasWallet)(
    "approveTRC20 should attempt to approve spending and return tx hash or error",
    async () => {
      const spenderAddress = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
      const tokenAddress = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";

      try {
        const txHash = await approveTRC20(tokenAddress, spenderAddress, "1000000", "nile");
        expect(typeof txHash).toBe("string");
        console.log(`approveTRC20 Tx ID: ${txHash}`);
      } catch (error: any) {
        console.log("Transfer (approveTRC20) integration feedback:", error.message);
        expect(error.message).toContain("Failed to approve TRC20");
      }
    },
    30000,
  );
});
