import axios from 'axios';
import { createLogger } from './logger';
import { MCPRequest, MCPResponse, createMCPRequest } from './models';

const logger = createLogger('mcp-client');

export class MCPClient {
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(baseUrl: string, timeout: number = 30, maxRetries: number = 3) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = timeout * 1000; // Convert to milliseconds
    this.maxRetries = maxRetries;
  }

  /**
   * Make an MCP request to the server
   */
  async makeRequest(method: string, params: Record<string, any> = {}): Promise<MCPResponse> {
    const request = createMCPRequest(method, params);
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug(`Making MCP request to ${this.baseUrl}`, { 
          method, 
          params, 
          attempt 
        });

        const response = await axios.post(`${this.baseUrl}/mcp`, request, {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (response.status === 200 && response.data) {
          logger.debug(`MCP request successful`, { method, status: response.status });
          return response.data as MCPResponse;
        } else {
          throw new Error(`Unexpected response status: ${response.status}`);
        }

      } catch (error: any) {
        const isLastAttempt = attempt === this.maxRetries;
        
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          logger.warn(`MCP server unreachable at ${this.baseUrl}`, { 
            attempt, 
            error: error.message 
          });
          
          if (isLastAttempt) {
            throw new Error(`MCP server unreachable: ${this.baseUrl}`);
          }
        } else if (error.code === 'ECONNABORTED') {
          logger.warn(`MCP request timeout to ${this.baseUrl}`, { 
            attempt, 
            timeout: this.timeout 
          });
          
          if (isLastAttempt) {
            throw new Error(`MCP server timeout: ${this.baseUrl}`);
          }
        } else {
          logger.error(`MCP request failed`, { 
            method, 
            attempt, 
            error: error.message 
          });
          
          if (isLastAttempt) {
            throw error;
          }
        }

        // Wait before retry (exponential backoff)
        if (!isLastAttempt) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`Failed to make MCP request after ${this.maxRetries} attempts`);
  }

  /**
   * Get available methods/tools from the MCP server
   */
  async getAvailableTools(): Promise<string[]> {
    try {
      const response = await this.makeRequest('tools/list', {});
      
      if (response.error) {
        logger.error(`Error getting tools from ${this.baseUrl}:`, response.error);
        return [];
      }

      if (response.result && response.result.tools) {
        const tools = response.result.tools;
        if (Array.isArray(tools)) {
          return tools.map((tool: any) => tool.name || tool.method || 'unknown');
        }
      }

      // Fallback: try the legacy get_methods approach
      const methodsResponse = await this.makeRequest('get_methods', {});
      
      if (methodsResponse.error) {
        logger.warn(`No tools found using either tools/list or get_methods for ${this.baseUrl}`);
        return [];
      }

      if (methodsResponse.result && methodsResponse.result.methods) {
        const methods = methodsResponse.result.methods;
        if (Array.isArray(methods)) {
          return methods.map((method: any) => method.name || 'unknown');
        }
      }

      return [];

    } catch (error: any) {
      logger.error(`Failed to get tools from ${this.baseUrl}:`, error.message);
      return [];
    }
  }

  /**
   * Check if the MCP server is healthy/reachable
   */
  async checkHealth(): Promise<boolean> {
    try {
      // Try a simple ping or tools/list request
      const response = await this.makeRequest('tools/list', {});
      return !response.error;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get server information
   */
  async getServerInfo(): Promise<{ name?: string; version?: string; description?: string }> {
    try {
      const response = await this.makeRequest('server/info', {});
      
      if (response.error || !response.result) {
        return {};
      }

      return {
        name: response.result.name,
        version: response.result.version,
        description: response.result.description,
      };
    } catch (error) {
      return {};
    }
  }
}