import { ConfigurationManager } from './config';
import { WebUIServer } from './web-ui-server';
import { createLogger } from './logger';

const logger = createLogger('api-server');

/**
 * API-only server (without frontend)
 */
async function startAPIServer(): Promise<void> {
  try {
    // Load configuration
    const configManager = new ConfigurationManager();
    const config = await configManager.loadConfig('proxy_config.yaml');
    
    logger.info('Configuration loaded successfully');
    
    // Validate configuration
    configManager.validateConfig(config);
    logger.info('Configuration validation passed');
    
    // Start API Server (without serving static files)
    const apiServer = new WebUIServer(config);
    await apiServer.start(8080); // Use different port for API
    
    logger.info('🚀 API Server started successfully!');
    logger.info('📡 API: http://localhost:8080');
    logger.info('🔗 Proxy: http://localhost:8000 (coming soon)');
    
  } catch (error) {
    logger.error('Failed to start API server:', error);
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

// Start the API server
if (require.main === module) {
  startAPIServer().catch((error) => {
    logger.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { startAPIServer };