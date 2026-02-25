import { describe, it, expect } from "vitest";
import { estimateEnergy } from "../../../src/core/services/contracts";

// Simple Storage Contract ABI
const SIMPLE_STORAGE_ABI = [
  {
    inputs: [],
    name: "get",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "x", type: "uint256" }],
    name: "set",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

describe("EstimateEnergy Integration (Nile)", () => {
  const CONTRACT_ADDRESS = "TDV5ZhhGSyD9BM31EKbm4NUCwKuhwiuEJd";

  it("should estimate energy for 'get' call on Nile", async () => {
    console.log(`Estimating energy for 'get' on ${CONTRACT_ADDRESS}...`);

    const energy = await estimateEnergy(
      {
        address: CONTRACT_ADDRESS,
        functionName: "get",
        abi: SIMPLE_STORAGE_ABI,
        // ownerAddress is optional, using dummy in service if not provided
      },
      "nile",
    );

    console.log(`Estimated energy (get): ${JSON.stringify(energy)}`);
    expect(energy.energyUsed).toBeGreaterThanOrEqual(0);
    expect(energy.totalEnergy).toBeGreaterThanOrEqual(energy.energyUsed);
  }, 30000);

  it("should estimate energy for 'set' call on Nile", async () => {
    console.log(`Estimating energy for 'set(100)' on ${CONTRACT_ADDRESS}...`);

    const energy = await estimateEnergy(
      {
        address: CONTRACT_ADDRESS,
        functionName: "set",
        args: [100],
        abi: SIMPLE_STORAGE_ABI,
      },
      "nile",
    );

    console.log(`Estimated energy (set): ${JSON.stringify(energy)}`);
    expect(energy.energyUsed).toBeGreaterThan(0); // 'set' should definitely use some energy
    expect(energy.totalEnergy).toBeGreaterThanOrEqual(energy.energyUsed);
  }, 30000);
});
