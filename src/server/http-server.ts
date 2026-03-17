import { createHttpApp } from "./http-app.js";
import { MCP_PROTOCOL_VERSION } from "./server.js";

// Environment variables
const PORT = parseInt(process.env.MCP_PORT || "3001", 10);
const HOST = process.env.MCP_HOST || "0.0.0.0";

console.error(`Configured to listen on ${HOST}:${PORT}`);

const isReadOnly = process.argv.includes("--readonly") || process.argv.includes("-r");
const { app, shutdown } = createHttpApp({ readOnly: isReadOnly });

// Handle process termination gracefully
process.on("SIGINT", async () => {
  console.error("Shutting down server...");
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.error("Received SIGTERM, shutting down...");
  await shutdown();
  process.exit(0);
});

// Start the HTTP server
const httpServer = app
  .listen(PORT, HOST, () => {
    console.error(`mcp-server-tron running at http://${HOST}:${PORT}`);
    console.error(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
    console.error(`Health check: http://${HOST}:${PORT}/health`);
    console.error(`Protocol: MCP ${MCP_PROTOCOL_VERSION} (Streamable HTTP)`);
  })
  .on("error", (err: Error) => {
    console.error(`Server error: ${err}`);
    process.exit(1);
  });

// Set server timeout to prevent hanging connections
httpServer.timeout = 120000; // 2 minutes
httpServer.keepAliveTimeout = 65000; // 65 seconds
