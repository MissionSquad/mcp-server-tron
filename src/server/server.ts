import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTRONResources } from "../core/resources.js";
import { registerTRONTools } from "../core/tools/index.js";
import { registerTRONPrompts } from "../core/prompts.js";
import { getSupportedNetworks } from "../core/chains.js";

const require = createRequire(import.meta.url);
export const { version } = require("../../package.json");

/** MCP protocol version supported by this server (from SDK LATEST_PROTOCOL_VERSION). */
export const MCP_PROTOCOL_VERSION = "2025-11-25";

// Create and start the MCP server
async function startServer(options: { readOnly?: boolean } = {}) {
  try {
    // Create a new MCP server instance with capabilities
    const server = new McpServer(
      {
        name: "mcp-server-tron",
        version,
      },
      {
        capabilities: {
          tools: {
            listChanged: true,
          },
          resources: {
            subscribe: false,
            listChanged: true,
          },
          prompts: {
            listChanged: true,
          },
          logging: {},
        },
      },
    );

    // Register all resources, tools, and prompts
    registerTRONResources(server);
    registerTRONTools(server, options);
    registerTRONPrompts(server, options);

    // Log server information
    console.log(`mcp-server-tron v${version} initialized`);
    if (options.readOnly) {
      console.log("Mode: Read-only (Write tools disabled)");
    }
    console.log(`Protocol: MCP ${MCP_PROTOCOL_VERSION}`);
    console.log(`Supported networks: ${getSupportedNetworks().length} networks`);
    console.log("Server is ready to handle requests");

    return server;
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
}

// Export the server creation function
export default startServer;
