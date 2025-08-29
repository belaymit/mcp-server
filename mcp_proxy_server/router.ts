import { RoutingConfig, ServerConfig } from "./config";
import { createLogger } from "./logger";

const logger = createLogger("router");

export interface MCPRequest {
  method: string;
  params?: Record<string, any>;
  id?: string | number;
  jsonrpc: string;
}

export interface RoutingResult {
  serverName: string;
  serverUrl: string;
  success: boolean;
  error?: string;
}

export class RoutingError extends Error {
  constructor(
    message: string,
    public readonly details: string,
    public readonly requestPath?: string,
    public readonly headers?: Record<string, string>
  ) {
    super(message);
    this.name = "RoutingError";
  }
}

export class Router {
  private config: RoutingConfig;
  private servers: Record<string, ServerConfig>;

  constructor(config: RoutingConfig, servers: Record<string, ServerConfig>) {
    this.config = config;
    this.servers = servers;
    logger.info(`Router initialized with strategy: ${config.strategy}`);
  }

  /**
   * Route an incoming request to determine the target server.
   * @param request The MCP request to route
   * @param requestPath The request path (for prefix-based routing)
   * @param headers The request headers (for header-based routing)
   * @returns RoutingResult containing server information or error
   */
  routeRequest(
    request: MCPRequest,
    requestPath?: string,
    headers?: Record<string, string>
  ): RoutingResult {
    try {
      let serverName: string | null = null;

      if (this.config.strategy === "prefix") {
        serverName = this.routeByPrefix(requestPath);
      } else if (this.config.strategy === "header") {
        serverName = this.routeByHeader(headers);
      } else {
        throw new RoutingError(
          "Invalid routing strategy",
          `Unknown strategy: ${this.config.strategy}`
        );
      }

      // If no server found and we have a default server, use it
      if (!serverName && this.config.defaultServer) {
        serverName = this.config.defaultServer;
        logger.debug(`Using default server: ${serverName}`);
      }

      if (!serverName) {
        throw new RoutingError(
          "No route found",
          "No matching routing rule found and no default server configured",
          requestPath,
          headers
        );
      }

      const serverUrl = this.getServerUrl(serverName);
      
      logger.info(`Request routed to server: ${serverName} (${serverUrl})`, {
        method: request.method,
        serverName,
        serverUrl,
        strategy: this.config.strategy,
        requestPath,
        headers: headers ? Object.keys(headers) : undefined
      });

      return {
        serverName,
        serverUrl,
        success: true
      };

    } catch (error) {
      if (error instanceof RoutingError) {
        logger.warn(`Routing failed: ${error.message}`, {
          details: error.details,
          requestPath: error.requestPath,
          headers: error.headers
        });
        return {
          serverName: "",
          serverUrl: "",
          success: false,
          error: error.message
        };
      }

      logger.error(`Unexpected routing error: ${error}`, {
        method: request.method,
        requestPath,
        headers
      });

      return {
        serverName: "",
        serverUrl: "",
        success: false,
        error: "Internal routing error"
      };
    }
  }

  /**
   * Route request based on URL prefix.
   * Extracts the first path segment and matches it against routing rules.
   */
  private routeByPrefix(requestPath?: string): string | null {
    if (!requestPath) {
      logger.debug("No request path provided for prefix routing");
      return null;
    }

    // Remove leading slash and extract first segment
    const pathSegments = requestPath.replace(/^\/+/, "").split("/");
    const prefix = pathSegments[0];

    if (!prefix) {
      logger.debug("No prefix found in request path", { requestPath });
      return null;
    }

    // Check if prefix matches any routing rule
    const serverName = this.config.rules[prefix];
    if (serverName) {
      logger.debug(`Prefix routing match found: ${prefix} -> ${serverName}`);
      return serverName;
    }

    logger.debug(`No routing rule found for prefix: ${prefix}`, {
      availableRules: Object.keys(this.config.rules)
    });
    return null;
  }

  /**
   * Route request based on X-Target-MCP header.
   */
  private routeByHeader(headers?: Record<string, string>): string | null {
    if (!headers) {
      logger.debug("No headers provided for header routing");
      return null;
    }

    // Look for X-Target-MCP header (case-insensitive)
    const targetHeader = Object.keys(headers).find(
      key => key.toLowerCase() === "x-target-mcp"
    );

    if (!targetHeader) {
      logger.debug("X-Target-MCP header not found", {
        availableHeaders: Object.keys(headers)
      });
      return null;
    }

    const targetValue = headers[targetHeader];
    if (!targetValue) {
      logger.debug("X-Target-MCP header is empty");
      return null;
    }

    // Check if header value matches any routing rule
    const serverName = this.config.rules[targetValue];
    if (serverName) {
      logger.debug(`Header routing match found: ${targetValue} -> ${serverName}`);
      return serverName;
    }

    logger.debug(`No routing rule found for header value: ${targetValue}`, {
      availableRules: Object.keys(this.config.rules)
    });
    return null;
  }

  /**
   * Get the URL for a server by name.
   * @param serverName The name of the server
   * @returns The server URL
   * @throws RoutingError if server not found
   */
  getServerUrl(serverName: string): string {
    const server = this.servers[serverName];
    if (!server) {
      throw new RoutingError(
        "Server not found",
        `Server '${serverName}' is not configured`,
        undefined,
        undefined
      );
    }
    return server.url;
  }

  /**
   * Get all available routing rules.
   */
  getRoutingRules(): Record<string, string> {
    return { ...this.config.rules };
  }

  /**
   * Get the current routing strategy.
   */
  getRoutingStrategy(): string {
    return this.config.strategy;
  }

  /**
   * Get the default server if configured.
   */
  getDefaultServer(): string | undefined {
    return this.config.defaultServer;
  }

  /**
   * Check if a server exists in the configuration.
   */
  hasServer(serverName: string): boolean {
    return serverName in this.servers;
  }

  /**
   * Get all configured server names.
   */
  getServerNames(): string[] {
    return Object.keys(this.servers);
  }

  /**
   * Reload configuration (used for hot-reloading).
   */
  reloadConfig(config: RoutingConfig, servers: Record<string, ServerConfig>): void {
    this.config = config;
    this.servers = servers;
    logger.info(`Router configuration reloaded with strategy: ${config.strategy}`, {
      serverCount: Object.keys(servers).length,
      ruleCount: Object.keys(config.rules).length
    });
  }

  /**
   * Validate routing configuration.
   */
  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check if strategy is valid
    if (!["prefix", "header"].includes(this.config.strategy)) {
      errors.push(`Invalid routing strategy: ${this.config.strategy}`);
    }

    // Check if routing rules reference existing servers
    for (const [ruleKey, serverName] of Object.entries(this.config.rules)) {
      if (!this.hasServer(serverName)) {
        errors.push(`Routing rule '${ruleKey}' references unknown server '${serverName}'`);
      }
    }

    // Check if default server exists
    if (this.config.defaultServer && !this.hasServer(this.config.defaultServer)) {
      errors.push(`Default server '${this.config.defaultServer}' not found`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}