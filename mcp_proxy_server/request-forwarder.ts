/**
 * Request forwarding logic for the MCP Proxy Server.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { MCPRequest, MCPResponse, createMCPErrorResponse } from './models';
import { createLogger } from './logger';

const logger = createLogger('request-forwarder');

export interface ForwardingOptions {
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export class RequestForwarder {
  private httpClient: AxiosInstance;
  private defaultOptions: ForwardingOptions = {
    timeout: 30000,
    maxRetries: 3,
    retryDelay: 1000
  };

  constructor(options?: ForwardingOptions) {
    const opts = { ...this.defaultOptions, ...options };
    
    this.httpClient = axios.create({
      timeout: opts.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    logger.info('Request forwarder initialized', { options: opts });
  }

  /**
   * Forward a request to a downstream MCP server.
   */
  async forwardRequest(serverUrl: string, request: MCPRequest, options?: ForwardingOptions): Promise<MCPResponse> {
    const opts = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    
    logger.info(`Forwarding request to ${serverUrl}`, {
      method: request.method,
      id: request.id,
      serverUrl
    });

    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= opts.maxRetries!; attempt++) {
      try {
        const response = await this.httpClient.post(serverUrl, request, {
          timeout: opts.timeout
        });

        const duration = Date.now() - startTime;
        logger.info(`Request forwarded successfully`, {
          method: request.method,
          id: request.id,
          serverUrl,
          attempt,
          duration: `${duration}ms`,
          statusCode: response.status
        });

        // Validate response structure
        if (!this.isValidMCPResponse(response.data)) {
          throw new Error(`Invalid MCP response format from ${serverUrl}`);
        }

        return response.data as MCPResponse;

      } catch (error) {
        lastError = error as Error;
        const duration = Date.now() - startTime;
        
        if (this.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          
          logger.warn(`Request forwarding failed (attempt ${attempt}/${opts.maxRetries})`, {
            method: request.method,
            id: request.id,
            serverUrl,
            attempt,
            duration: `${duration}ms`,
            error: axiosError.message,
            statusCode: axiosError.response?.status,
            responseData: axiosError.response?.data
          });

          // If it's a client error (4xx), don't retry
          if (axiosError.response?.status && axiosError.response.status >= 400 && axiosError.response.status < 500) {
            break;
          }
        } else {
          logger.warn(`Request forwarding failed (attempt ${attempt}/${opts.maxRetries})`, {
            method: request.method,
            id: request.id,
            serverUrl,
            attempt,
            duration: `${duration}ms`,
            error: error instanceof Error ? error.message : String(error)
          });
        }

        // Wait before retrying (exponential backoff)
        if (attempt < opts.maxRetries!) {
          const delay = opts.retryDelay! * Math.pow(2, attempt - 1);
          logger.debug(`Waiting ${delay}ms before retry`, { attempt, delay });
          await this.sleep(delay);
        }
      }
    }

    // All retries failed
    const totalDuration = Date.now() - startTime;
    logger.error(`Request forwarding failed after ${opts.maxRetries} attempts`, {
      method: request.method,
      id: request.id,
      serverUrl,
      totalDuration: `${totalDuration}ms`,
      lastError: lastError?.message
    });

    // Return MCP-compliant error response
    return createMCPErrorResponse(
      -32603, // Internal error
      `Failed to forward request to ${serverUrl}: ${lastError?.message || 'Unknown error'}`,
      request.id,
      {
        serverUrl,
        attempts: opts.maxRetries,
        totalDuration: `${totalDuration}ms`
      }
    );
  }

  /**
   * Check if a server is healthy.
   */
  async checkServerHealth(serverUrl: string, healthCheckPath: string = '/health'): Promise<boolean> {
    try {
      const healthUrl = `${serverUrl}${healthCheckPath}`;
      logger.debug(`Checking server health`, { serverUrl, healthUrl });
      
      const response = await this.httpClient.get(healthUrl, {
        timeout: 5000 // Shorter timeout for health checks
      });

      const isHealthy = response.status >= 200 && response.status < 300;
      logger.debug(`Server health check result`, {
        serverUrl,
        healthUrl,
        statusCode: response.status,
        isHealthy
      });

      return isHealthy;
    } catch (error) {
      logger.warn(`Server health check failed`, {
        serverUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Validate if response follows MCP protocol structure.
   */
  private isValidMCPResponse(data: any): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    // Must have jsonrpc field
    if (data.jsonrpc !== '2.0') {
      return false;
    }

    // Must have either result or error, but not both
    const hasResult = 'result' in data;
    const hasError = 'error' in data;
    
    if (hasResult && hasError) {
      return false;
    }
    
    if (!hasResult && !hasError) {
      return false;
    }

    // If error, validate error structure
    if (hasError) {
      const error = data.error;
      if (!error || typeof error !== 'object') {
        return false;
      }
      if (typeof error.code !== 'number' || typeof error.message !== 'string') {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if error is an Axios error.
   */
  private isAxiosError(error: any): error is AxiosError {
    return error && error.isAxiosError === true;
  }

  /**
   * Sleep for specified milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get request forwarding statistics.
   */
  getStats(): { [key: string]: any } {
    // TODO: Implement statistics tracking
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0
    };
  }
}