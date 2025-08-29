import * as dotenv from "dotenv";
import * as path from "path";
import { ConfigurationManager } from "./config";
import { WebUIServer } from "./web-ui-server";
import { createLogger } from "./logger";

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, ".env") });

const logger = createLogger("app");

async function startApplication(): Promise<void> {
  try {
    // Load configuration
    const configManager = new ConfigurationManager();
    const config = await configManager.loadConfig("proxy_config.yaml");

    logger.info("Configuration loaded successfully");

    // Validate configuration
    configManager.validateConfig(config);
    logger.info("Configuration validation passed");

    // Start Web UI Server if enabled
    if (config.ui.enabled) {
      const webUIServer = new WebUIServer(config);
      await webUIServer.start();
      logger.info(`Web UI available at http://localhost:${config.ui.port}`);
    } else {
      logger.info("Web UI is disabled in configuration");
    }

    // TODO: Start MCP Proxy Server
    // const proxyServer = new MCPProxyServer(config);
    // await proxyServer.start(config.server.port);
    logger.info(
      `MCP Proxy Server would start on port ${config.server.port} (not implemented yet)`
    );

    logger.info("🚀 Application started successfully!");
    logger.info(`📱 Web UI: http://localhost:${config.ui.port}`);
    logger.info(
      `🔗 Proxy: http://localhost:${config.server.port} (coming soon)`
    );
  } catch (error) {
    logger.error("Failed to start application:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down gracefully");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

// Start the application
if (require.main === module) {
  startApplication().catch((error) => {
    logger.error("Unhandled error:", error);
    process.exit(1);
  });
}

export { startApplication };
