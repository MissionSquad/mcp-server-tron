import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RegisterToolFn } from "./types.js";
import { registerWalletTools } from "./wallet.js";
import { registerNetworkTools } from "./network.js";
import { registerAddressTools } from "./address.js";
import { registerBlockTools } from "./block.js";
import { registerBalanceTools } from "./balance.js";
import { registerTransactionTools } from "./transaction.js";
import { registerContractTools } from "./contract.js";
import { registerTransferTools } from "./transfer.js";
import { registerStakingTools } from "./staking.js";
import { registerQueryTools } from "./query.js";
import { registerBroadcastTools } from "./broadcast.js";
import { registerNodeTools } from "./node.js";
import { registerMempoolTools } from "./mempool.js";
import { registerEventTools } from "./event.js";
import { registerAccountTools } from "./account.js";
import { registerGovernanceTools } from "./governance.js";
import { registerProposalTools } from "./proposals.js";
import { registerAccountDataTools } from "./account-data.js";
import { registerContractDataTools } from "./contract-data.js";
import { registerAccountResourceTools } from "./account-resource.js";

/**
 * Register all TRON-related tools with the MCP server
 *
 * Write operations are registered up front and validate wallet availability
 * when the tool handler runs. Private keys and mnemonics are never passed as
 * tool arguments for security reasons.
 *
 * @param server The MCP server instance
 * @param options Registration options (e.g., readOnly mode)
 */
export function registerTRONTools(server: McpServer, options: { readOnly?: boolean } = {}) {
  /**
   * Helper to register a tool with read-only gating.
   * Write tools (`readOnlyHint` not true) are omitted when `options.readOnly` is set;
   * wallet availability is validated inside handlers when invoked.
   */
  const registerTool: RegisterToolFn = <T extends z.ZodRawShape>(
    name: string,
    definition: {
      inputSchema?: T;
      description?: string;
      annotations?: {
        title?: string;
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
      };
    },
    handler: (args: z.infer<z.ZodObject<T>>) => Promise<any>,
  ) => {
    const annotations = definition.annotations || {};
    // Default to false: tools without explicit readOnlyHint are treated as write-capable
    // for safety. This is stricter than prompts.ts (which defaults to read-only) because
    // tools can directly mutate blockchain state.
    const isReadOnly = annotations.readOnlyHint === true;

    // 1. Skip if in read-only mode and the tool is a write operation
    if (options.readOnly && !isReadOnly) {
      return;
    }

    server.registerTool(name, definition as any, handler as any);
  };

  registerWalletTools(registerTool);
  registerNetworkTools(registerTool);
  registerAddressTools(registerTool);
  registerBlockTools(registerTool);
  registerBalanceTools(registerTool);
  registerTransactionTools(registerTool);
  registerContractTools(registerTool);
  registerTransferTools(registerTool);
  registerStakingTools(registerTool);
  registerAccountResourceTools(registerTool);
  registerQueryTools(registerTool);
  registerBroadcastTools(registerTool);
  registerNodeTools(registerTool);
  registerMempoolTools(registerTool);
  registerEventTools(registerTool);
  registerAccountTools(registerTool);
  registerGovernanceTools(registerTool);
  registerProposalTools(registerTool);
  registerAccountDataTools(registerTool);
  registerContractDataTools(registerTool);
}
