import { ProxyConfig } from "./config";
import { Router } from "./router";
import { RequestForwarder } from "./request-forwarder";
import { ResponseAggregator } from "./response-aggregator";
import { MCPRequest, MCPResponse, createMCPErrorResponse } from "./models";
import { createLogger } from "./logger";

const logger = createLogger("proxy-server");

export class MCPProxyServer {
  private router: Router;
  private requestForwarder: RequestForwarder;
  private responseAggregator: ResponseAggregator;
  private running = false;
  private server: any = null;
  private startTime: Date | null = null;
  private requestCount = 0;

  constructor(private config: ProxyConfig) {
    this.router = new Router(config.routing, config.servers);
    this.requestForwarder = new RequestForwarder();
    this.responseAggregator = new ResponseAggregator(this.requestForwarder);

    logger.info("MCP Proxy Server initialized", {
      serverCount: Object.keys(config.servers).length,
      routingStrategy: config.routing.strategy
    });
  }

  /**
   * Start the MCP Proxy Server.
   */
  async start(port: number = 8000): Promise<void> {
    if (this.running) {
      logger.warn("Server is already running");
      return;
    }

    this.running = true;
    this.startTime = new Date();
    this.requestCount = 0;

    logger.info(`Starting MCP Proxy Server on port ${port}`, {
      port,
      configuredServers: Object.keys(this.config.servers),
      routingStrategy: this.config.routing.strategy
    });

    const express = require("express");
    const app = express();

    // Add request logging middleware
    app.use((req: any, res: any, next: any) => {
      const startTime = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        logger.info("HTTP request completed", {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          userAgent: req.get('User-Agent')
        });
      });
      next();
    });

    app.use(express.json());

    // Handle MCP requests - support both root and path-based routing
    app.post("*", async (req: any, res: any) => {
      try {
        this.requestCount++;
        const startTime = Date.now();
        
        logger.info("Processing MCP request", {
          method: req.body?.method,
          id: req.body?.id,
          requestNumber: this.requestCount,
          path: req.path,
          userAgent: req.get('User-Agent')
        });

        const response = await this.handleRequest(
          req.body, 
          req.path, 
          req.headers
        );
        
        const duration = Date.now() - startTime;
        logger.info("MCP request completed", {
          method: req.body?.method,
          id: req.body?.id,
          duration: `${duration}ms`,
          success: !response.error
        });

        res.json(response);
      } catch (error) {
        logger.error("Request handling error:", error, {
          method: req.body?.method,
          id: req.body?.id,
          path: req.path
        });
        res.status(500).json({
          error: {
            code: -32603,
            message: "Internal server error",
          },
          jsonrpc: "2.0",
          id: req.body?.id
        });
      }
    });

    // Enhanced health check endpoint
    app.get("/health", (req: any, res: any) => {
      const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;
      const serverStatuses: Record<string, any> = {};
      
      // Check configured servers (basic status)
      for (const [name, config] of Object.entries(this.config.servers)) {
        serverStatuses[name] = {
          url: config.url,
          configured: true
        };
      }

      res.json({ 
        status: "healthy", 
        timestamp: new Date().toISOString(),
        uptime: `${Math.floor(uptime / 1000)}s`,
        requestCount: this.requestCount,
        configuredServers: Object.keys(this.config.servers),
        servers: serverStatuses
      });
    });

    // Server status endpoint
    app.get("/status", (req: any, res: any) => {
      const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;
      
      res.json({
        running: this.running,
        startTime: this.startTime?.toISOString(),
        uptime: `${Math.floor(uptime / 1000)}s`,
        requestCount: this.requestCount,
        config: {
          serverCount: Object.keys(this.config.servers).length,
          routingStrategy: this.config.routing.strategy,
          servers: Object.keys(this.config.servers)
        }
      });
    });

    return new Promise<void>((resolve, reject) => {
      this.server = app.listen(port, (error: any) => {
        if (error) {
          logger.error("Failed to start server:", error);
          this.running = false;
          reject(error);
          return;
        }

        logger.info(`MCP Proxy Server successfully started`, {
          port,
          pid: process.pid,
          nodeVersion: process.version,
          uptime: "0s"
        });

        // Setup graceful shutdown handlers
        this.setupShutdownHandlers();
        resolve();
      });
    });
  }

  /**
   * Stop the MCP Proxy Server gracefully.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      logger.warn("Server is not running");
      return;
    }

    logger.info("Initiating graceful shutdown of MCP Proxy Server", {
      requestCount: this.requestCount,
      uptime: this.startTime ? `${Math.floor((Date.now() - this.startTime.getTime()) / 1000)}s` : "unknown"
    });

    this.running = false;

    return new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info("MCP Proxy Server stopped successfully", {
            totalRequests: this.requestCount,
            finalUptime: this.startTime ? `${Math.floor((Date.now() - this.startTime.getTime()) / 1000)}s` : "unknown"
          });
          this.server = null;
          this.startTime = null;
          resolve();
        });
      } else {
        logger.info("No server instance to close");
        resolve();
      }
    });
  }

  /**
   * Check if the server is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get server statistics.
   */
  getStats() {
    const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;
    return {
      running: this.running,
      startTime: this.startTime?.toISOString(),
      uptime: Math.floor(uptime / 1000),
      requestCount: this.requestCount,
      configuredServers: Object.keys(this.config.servers)
    };
  }

  /**
   * Setup graceful shutdown handlers for process signals.
   */
  private setupShutdownHandlers(): void {
    const gracefulShutdown = (signal: string) => {
      logger.info(`Received ${signal}, initiating graceful shutdown...`);
      
      this.stop().then(() => {
        logger.info("Graceful shutdown completed");
        process.exit(0);
      }).catch((error) => {
        logger.error("Error during shutdown:", error);
        process.exit(1);
      });
    };

    // Handle various shutdown signals
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGQUIT", () => gracefulShutdown("SIGQUIT"));

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught exception:", error);
      this.stop().then(() => {
        process.exit(1);
      });
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled promise rejection:", { reason, promise });
      this.stop().then(() => {
        process.exit(1);
      });
    });
  }

  /**
   * Handle an incoming MCP request.
   */
  async handleRequest(
    request: MCPRequest, 
    requestPath?: string, 
    headers?: Record<string, string>
  ): Promise<MCPResponse> {
    const requestStartTime = Date.now();
    
    logger.info("Processing MCP request", {
      method: request.method,
      id: request.id,
      hasParams: !!request.params,
      requestPath,
      headerKeys: headers ? Object.keys(headers) : undefined
    });

    try {
      // Special handling for get_methods - aggregate from all servers
      if (request.method === "get_methods") {
        logger.info("Aggregating methods from all configured servers", {
          serverCount: Object.keys(this.config.servers).length
        });

        const serverUrls: Record<string, string> = {};
        for (const [name, config] of Object.entries(this.config.servers)) {
          serverUrls[name] = config.url;
        }
        
        const response = await this.responseAggregator.aggregateMethods(serverUrls);
        const duration = Date.now() - requestStartTime;
        
        logger.info("Method aggregation completed", {
          duration: `${duration}ms`,
          methodCount: response.result?.methods?.length || 0
        });
        
        return response;
      }

      // Route the request to appropriate server
      const routingResult = this.router.routeRequest(request, requestPath, headers);
      
      if (!routingResult.success) {
        logger.warn("Request routing failed", {
          method: request.method,
          id: request.id,
          error: routingResult.error,
          requestPath,
          headers
        });

        return createMCPErrorResponse(
          -32601, // Method not found
          routingResult.error || "No route found for request",
          request.id,
          { requestPath, availableServers: Object.keys(this.config.servers) }
        );
      }
      
      logger.info("Request routed successfully", {
        method: request.method,
        targetServer: routingResult.serverName,
        targetUrl: routingResult.serverUrl,
        routingStrategy: this.config.routing.strategy
      });

      // Forward the request
      const response = await this.requestForwarder.forwardRequest(
        routingResult.serverUrl,
        request
      );

      const duration = Date.now() - requestStartTime;
      logger.info("Request forwarding completed", {
        method: request.method,
        targetServer: routingResult.serverName,
        duration: `${duration}ms`,
        success: !response.error
      });

      return response;
    } catch (error) {
      const duration = Date.now() - requestStartTime;
      logger.error("Error handling MCP request", {
        method: request.method,
        id: request.id,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined
      });

      // Return MCP-compliant error response
      return createMCPErrorResponse(
        -32603, // Internal error
        error instanceof Error ? error.message : "Unknown error",
        request.id
      );
    }
  }
}
