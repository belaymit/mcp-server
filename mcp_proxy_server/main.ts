import * as dotenv from 'dotenv';
import * as path from 'path';
import { MCPProxyServer } from './proxy-server';
import { ConfigurationManager } from './config';
import { createLogger } from './logger';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '.env') });

const logger = createLogger('main');

async function main(configPath?: string): Promise<void> {
  // Load configuration
  const configFile = configPath || 'proxy_config.yaml';
  
  const configManager = new ConfigurationManager();
  
  try {
    const config = await configManager.loadConfig(configFile);
    logger.info(`Loaded configuration from ${configFile}`);
    
    // Validate configuration
    configManager.validateConfig(config);
    
    // Create and start proxy server
    const proxyServer = new MCPProxyServer(config);
    
    logger.info(`Starting MCP Proxy Server on port ${config.server.port}`);
    await proxyServer.start(config.server.port);
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

// Start the server
if (require.main === module) {
  const configPath = process.argv[2];
  main(configPath).catch((error) => {
    logger.error('Unhandled error:', error);
    process.exit(1);
  });
}