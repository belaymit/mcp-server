import { spawn, ChildProcess } from 'child_process';
import { createLogger } from './logger';
import { MCPRequest, MCPResponse, createMCPRequest } from './models';

const logger = createLogger('mcp-stdio-client');

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export class MCPStdioClient {
  private serverConfig: MCPServerConfig;
  private process: ChildProcess | null = null;
  private isConnected = false;
  private requestId = 0;
  private pendingRequests = new Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }>();

  constructor(serverConfig: MCPServerConfig) {
    this.serverConfig = serverConfig;
  }

  /**
   * Start the MCP server process and establish connection
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      logger.info(`Starting MCP server: ${this.serverConfig.name}`, {
        command: this.serverConfig.command,
        args: this.serverConfig.args
      });

      // Spawn the MCP server process
      this.process = spawn(this.serverConfig.command, this.serverConfig.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.serverConfig.env },
        shell: true, // Enable shell for npx to work on Windows
        windowsHide: true
      });

      if (!this.process.stdout || !this.process.stdin || !this.process.stderr) {
        throw new Error('Failed to create stdio pipes for MCP server');
      }

      // Handle process events
      this.process.on('error', (error) => {
        logger.error(`MCP server process error for ${this.serverConfig.name}:`, error);
        this.isConnected = false;
      });

      this.process.on('exit', (code, signal) => {
        logger.warn(`MCP server ${this.serverConfig.name} exited`, { code, signal });
        this.isConnected = false;
        this.cleanup();
      });

      // Handle stderr for debugging
      this.process.stderr.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
          logger.debug(`MCP server ${this.serverConfig.name} stderr:`, message);
        }
      });

      // Set up JSON-RPC communication
      let buffer = '';
      this.process.stdout.on('data', (data) => {
        buffer += data.toString();
        
        // Process complete JSON-RPC messages
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          
          if (line) {
            try {
              // Only try to parse lines that look like JSON-RPC (start with '{')
              if (line.startsWith('{')) {
                const response = JSON.parse(line) as MCPResponse;
                this.handleResponse(response);
              } else {
                // Log non-JSON output as debug info
                logger.debug(`MCP server ${this.serverConfig.name} output:`, line);
              }
            } catch (error) {
              logger.debug(`Non-JSON output from ${this.serverConfig.name}:`, line);
            }
          }
        }
      });

      // Wait for the process to be ready and send initialize request
      await this.waitForProcessReady();
      await this.initialize();
      this.isConnected = true;

      logger.info(`Successfully connected to MCP server: ${this.serverConfig.name}`);

    } catch (error: any) {
      logger.error(`Failed to connect to MCP server ${this.serverConfig.name}:`, error);
      this.cleanup();
      throw error;
    }
  }

  /**
   * Wait for the MCP server process to be ready to receive JSON-RPC messages
   */
  private async waitForProcessReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.process) {
        reject(new Error('Process not started'));
        return;
      }

      let hasReceivedOutput = false;
      // Increase timeout for slower servers like GitHub
      const timeoutMs = this.serverConfig.name === 'github' ? 15000 : 8000;
      const timeout = setTimeout(() => {
        if (!hasReceivedOutput) {
          // Try to proceed anyway - some servers might not output anything initially
          logger.warn(`MCP server ${this.serverConfig.name} did not output anything, trying to proceed anyway`);
          resolve();
        }
      }, timeoutMs);

      // Listen for any output indicating the server is ready
      const onData = (data: Buffer) => {
        const output = data.toString();
        // Look for signs that the server is ready (any output usually means it's started)
        if (output.trim()) {
          hasReceivedOutput = true;
          clearTimeout(timeout);
          // Wait a bit more to ensure the server is fully ready
          setTimeout(resolve, 500);
        }
      };

      this.process.stdout?.once('data', onData);
      this.process.stderr?.once('data', onData);

      // Also resolve if we get an error (so we can handle it properly)
      this.process.once('error', () => {
        clearTimeout(timeout);
        reject(new Error(`MCP server ${this.serverConfig.name} failed to start`));
      });
    });
  }

  /**
   * Initialize the MCP connection
   */
  private async initialize(): Promise<void> {
    const initRequest = createMCPRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: {
          listChanged: true
        },
        sampling: {}
      },
      clientInfo: {
        name: 'mcp-proxy-server',
        version: '0.1.0'
      }
    });

    const response = await this.sendRequest(initRequest);
    
    if (response.error) {
      throw new Error(`MCP initialization failed: ${response.error.message}`);
    }

    // Send initialized notification
    const initializedNotification = {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    };

    this.sendNotification(initializedNotification);
  }

  /**
   * Send a request and wait for response
   */
  private async sendRequest(request: MCPRequest, timeoutMs: number = 10000): Promise<MCPResponse> {
    if (!this.process?.stdin) {
      throw new Error(`MCP server ${this.serverConfig.name} process is not available`);
    }

    const requestId = request.id || (++this.requestId).toString();
    const requestWithId = { ...request, id: requestId };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout for ${this.serverConfig.name}`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      const requestLine = JSON.stringify(requestWithId) + '\n';
      this.process!.stdin!.write(requestLine);
    });
  }

  /**
   * Send a notification (no response expected)
   */
  private sendNotification(notification: any): void {
    if (!this.process?.stdin) {
      return;
    }

    const notificationLine = JSON.stringify(notification) + '\n';
    this.process.stdin.write(notificationLine);
  }

  /**
   * Handle incoming responses
   */
  private handleResponse(response: MCPResponse): void {
    if (response.id) {
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        pending.resolve(response);
      }
    }
  }

  /**
   * Call a specific tool on the MCP server
   */
  async callTool(toolName: string, parameters: Record<string, any> = {}): Promise<any> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const toolRequest = createMCPRequest('tools/call', {
        name: toolName,
        arguments: parameters
      });

      const response = await this.sendRequest(toolRequest);

      if (response.error) {
        throw new Error(`Tool call failed: ${response.error.message}`);
      }

      return response.result;

    } catch (error: any) {
      logger.error(`Failed to call tool ${toolName}:`, error.message);
      throw error;
    }
  }

  /**
   * Get available tools from the MCP server
   */
  async getAvailableTools(): Promise<string[]> {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      // Try tools/list first (MCP 2024-11-05)
      const toolsRequest = createMCPRequest('tools/list', {});
      const toolsResponse = await this.sendRequest(toolsRequest);

      if (!toolsResponse.error && toolsResponse.result?.tools) {
        const tools = toolsResponse.result.tools;
        if (Array.isArray(tools)) {
          return tools.map((tool: any) => tool.name || 'unknown');
        }
      }

      // Fallback to resources/list if tools/list fails
      const resourcesRequest = createMCPRequest('resources/list', {});
      const resourcesResponse = await this.sendRequest(resourcesRequest);

      if (!resourcesResponse.error && resourcesResponse.result?.resources) {
        const resources = resourcesResponse.result.resources;
        if (Array.isArray(resources)) {
          return resources.map((resource: any) => `resource:${resource.name || resource.uri || 'unknown'}`);
        }
      }

      return [];

    } catch (error: any) {
      logger.error(`Failed to get tools from ${this.serverConfig.name}:`, error.message);
      return [];
    }
  }

  /**
   * Check if the server is healthy
   */
  async checkHealth(): Promise<boolean> {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return this.isConnected;
    } catch (error) {
      return false;
    }
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    this.cleanup();
  }

  private cleanup(): void {
    this.isConnected = false;

    // Clear pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    // Kill the process
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}