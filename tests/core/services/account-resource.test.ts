import { describe, it, expect } from "vitest";
import {
  delegateResource,
  undelegateResource,
  getCanDelegatedMaxSize,
  getDelegatedResourceV2,
  getDelegatedResourceAccountIndexV2,
} from "../../../src/core/services/account-resource.js";

describe("Account Resource Services Integration (Nile)", () => {
  const hasWallet = false;

  it.runIf(hasWallet)(
    "delegateResource should attempt to delegate and return error or tx hash",
    async () => {
      const receiverAddress = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";

      try {
        const txId = await delegateResource(
          {
            amount: 1_000_000, // 1 TRX in Sun
            receiverAddress,
            resource: "BANDWIDTH",
            lock: false,
          },
          "nile",
        );
        expect(typeof txId).toBe("string");
        console.log(`delegateResource Tx ID: ${txId}`);
      } catch (error: any) {
        console.log("AccountResource (delegateResource) integration feedback:", error.message);
        expect(error.message).toContain("Failed to delegate resource");
      }
    },
    30000,
  );

  it.runIf(hasWallet)(
    "undelegateResource should attempt to undelegate and return error or tx hash",
    async () => {
      const receiverAddress = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";

      try {
        const txId = await undelegateResource(
          {
            amount: 500_000,
            receiverAddress,
            resource: "BANDWIDTH",
          },
          "nile",
        );
        expect(typeof txId).toBe("string");
        console.log(`undelegateResource Tx ID: ${txId}`);
      } catch (error: any) {
        console.log("AccountResource (undelegateResource) integration feedback:", error.message);
        expect(error.message).toContain("Failed to undelegate resource");
      }
    },
    30000,
  );

  it.runIf(hasWallet)(
    "getCanDelegatedMaxSize should return max delegatable amount",
    async () => {
      const address = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
      const result = await getCanDelegatedMaxSize(address, "ENERGY", "nile");
      expect(result.address).toBe(address);
      expect(result.resource).toBe("ENERGY");
      expect(typeof result.maxSizeSun).toBe("bigint");
      console.log(
        `Can delegated max size (ENERGY) for ${address}: ${result.maxSizeSun.toString()} Sun`,
      );
    },
    30000,
  );

  it.runIf(hasWallet)(
    "getDelegatedResourceV2 should return delegated resource details or empty list",
    async () => {
      const from = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
      const to = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";

      try {
        const result = await getDelegatedResourceV2(from, to, "nile");
        expect(result.from).toBe(from);
        expect(result.to).toBe(to);
        expect(Array.isArray(result.delegatedResource)).toBe(true);
        console.log(
          `DelegatedResourceV2 entries between ${from} -> ${to}: ${result.delegatedResource.length}`,
        );
      } catch (error: any) {
        console.log(
          "AccountResource (getDelegatedResourceV2) integration feedback:",
          error.message,
        );
        expect(error.message).toContain("Failed to get delegated resource v2");
      }
    },
    30000,
  );

  it.runIf(hasWallet)(
    "getDelegatedResourceAccountIndexV2 should return delegation index",
    async () => {
      const address = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
      try {
        const result = await getDelegatedResourceAccountIndexV2(address, "nile");
        expect(result.account).toBeDefined();
        expect(Array.isArray(result.fromAccounts)).toBe(true);
        expect(Array.isArray(result.toAccounts)).toBe(true);
        console.log(
          `DelegatedResourceAccountIndexV2 for ${address}: from=${result.fromAccounts.length}, to=${result.toAccounts.length}`,
        );
      } catch (error: any) {
        console.log(
          "AccountResource (getDelegatedResourceAccountIndexV2) integration feedback:",
          error.message,
        );
        expect(error.message).toContain("Failed to get delegated resource account index v2");
      }
    },
    30000,
  );
});
