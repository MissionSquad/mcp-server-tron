import { getOwnerAddress, signMessageWithWallet, signTypedDataWithWallet } from "./agent-wallet.js";

/**
 * Get the address of the active wallet (works in all modes).
 */
export const getWalletAddress = getOwnerAddress;

/**
 * Sign an arbitrary message using the active wallet.
 */
export const signMessage = async (message: string): Promise<string> => {
  return signMessageWithWallet(message);
};

/**
 * Sign typed data (EIP-712) using the active wallet.
 */
export const signTypedData = async (
  domain: object,
  types: object,
  value: object,
): Promise<string> => {
  return signTypedDataWithWallet(domain, types, value);
};
