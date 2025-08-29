import { MCPResponse, MCPError, createMCPErrorResponse } from './models';
import { RoutingError } from './router';
import { createLogger } from './logger';

const logger = createLogger('error-handler');

export interface ErrorContext {
  requestId?: string;
  method?: string;
  serverName?: string;
  serverUrl?: string;
  requestPath?: string;
  headers?: Record<string, string>;
  timestamp?: Date;
}

export class DownstreamError extends Error {
  constructor(
    message: string,
    public readonly serverName: string,
    public readonly serverUrl: string,
    public readonly statusCode?: number,
    public readonly responseData?: any
  ) {
    super(message);
    this.name = 'DownstreamError';
  }
}

export class ErrorHandler {
  constructor() {
    logger.info('Error handler initialized');
  }

  /**
   * Handle routing errors for unknown routes and invalid requests.
   */
  handleRoutingError(error: RoutingError, context?: ErrorContext): MCPResponse {
    const errorCode = this.getErrorCodeForRoutingError(error);
    const errorMessage = this.formatRoutingErrorMessage(error);
    
    logger.warn('Routing error occurred', {
      error: error.message,
      details: error.details,
      requestPath: error.requestPath,
      headers: error.headers,
      context,
      errorCode
    });

    const errorData: any = {
      type: 'routing_error',
      details: error.details,
      timestamp: new Date().toISOString()
    };

    if (error.requestPath) {
      errorData.requestPath = error.requestPath;
    }

    if (error.headers) {
      errorData.availableHeaders = Object.keys(error.headers);
    }

    if (context?.method) {
      errorData.method = context.method;
    }

    return createMCPErrorResponse(
      errorCode,
      errorMessage,
      context?.requestId,
      errorData
    );
  }

  /**
   * Handle downstream server communication failures.
   */
  handleDownstreamError(error: DownstreamError, context?: ErrorContext): MCPResponse {
    const errorCode = this.getErrorCodeForDownstreamError(error);
    const errorMessage = this.formatDownstreamErrorMessage(error);
    
    logger.error('Downstream server error occurred', {
      error: error.message,
      serverName: error.serverName,
      serverUrl: error.serverUrl,
      statusCode: error.statusCode,
      responseData: error.responseData,
      context,
      errorCode
    });

    const errorData: any = {
      type: 'downstream_error',
      serverName: error.serverName,
      serverUrl: error.serverUrl,
      timestamp: new Date().toISOString()
    };

    if (error.statusCode) {
      errorData.statusCode = error.statusCode;
    }

    if (error.responseData) {
      errorData.serverResponse = error.responseData;
    }

    if (context?.method) {
      errorData.method = context.method;
    }

    return createMCPErrorResponse(
      errorCode,
      errorMessage,
      context?.requestId,
      errorData
    );
  }

  /**
   * Handle general MCP protocol errors.
   */
  handleProtocolError(
    error: Error, 
    context?: ErrorContext,
    customCode?: number
  ): MCPResponse {
    const errorCode = customCode || -32603; // Internal error
    const errorMessage = this.formatProtocolErrorMessage(error);
    
    logger.error('MCP protocol error occurred', {
      error: error.message,
      stack: error.stack,
      context,
      errorCode
    });

    const errorData: any = {
      type: 'protocol_error',
      originalError: error.name,
      timestamp: new Date().toISOString()
    };

    if (context?.method) {
      errorData.method = context.method;
    }

    if (context?.serverName) {
      errorData.serverName = context.serverName;
    }

    return createMCPErrorResponse(
      errorCode,
      errorMessage,
      context?.requestId,
      errorData
    );
  }

  /**
   * Handle validation errors for invalid request formats.
   */
  handleValidationError(
    validationErrors: string[],
    context?: ErrorContext
  ): MCPResponse {
    const errorMessage = `Invalid request format: ${validationErrors.join(', ')}`;
    
    logger.warn('Request validation error', {
      validationErrors,
      context
    });

    const errorData: any = {
      type: 'validation_error',
      validationErrors,
      timestamp: new Date().toISOString()
    };

    if (context?.method) {
      errorData.method = context.method;
    }

    return createMCPErrorResponse(
      -32600, // Invalid Request
      errorMessage,
      context?.requestId,
      errorData
    );
  }

  /**
   * Handle timeout errors.
   */
  handleTimeoutError(
    timeoutMs: number,
    context?: ErrorContext
  ): MCPResponse {
    const errorMessage = `Request timed out after ${timeoutMs}ms`;
    
    logger.warn('Request timeout error', {
      timeoutMs,
      context
    });

    const errorData: any = {
      type: 'timeout_error',
      timeoutMs,
      timestamp: new Date().toISOString()
    };

    if (context?.serverName) {
      errorData.serverName = context.serverName;
    }

    if (context?.method) {
      errorData.method = context.method;
    }

    return createMCPErrorResponse(
      -32603, // Internal error
      errorMessage,
      context?.requestId,
      errorData
    );
  }

  /**
   * Handle rate limiting errors.
   */
  handleRateLimitError(
    limit: number,
    windowMs: number,
    context?: ErrorContext
  ): MCPResponse {
    const errorMessage = `Rate limit exceeded: ${limit} requests per ${windowMs}ms`;
    
    logger.warn('Rate limit exceeded', {
      limit,
      windowMs,
      context
    });

    const errorData: any = {
      type: 'rate_limit_error',
      limit,
      windowMs,
      retryAfter: Math.ceil(windowMs / 1000), // seconds
      timestamp: new Date().toISOString()
    };

    return createMCPErrorResponse(
      -32000, // Server error (custom)
      errorMessage,
      context?.requestId,
      errorData
    );
  }

  /**
   * Create error context from request information.
   */
  createErrorContext(
    requestId?: string,
    method?: string,
    serverName?: string,
    serverUrl?: string,
    requestPath?: string,
    headers?: Record<string, string>
  ): ErrorContext {
    return {
      requestId,
      method,
      serverName,
      serverUrl,
      requestPath,
      headers,
      timestamp: new Date()
    };
  }

  /**
   * Log error with appropriate severity level.
   */
  logError(
    error: Error,
    severity: 'debug' | 'info' | 'warn' | 'error' = 'error',
    context?: ErrorContext,
    additionalData?: Record<string, any>
  ): void {
    const logData = {
      error: error.message,
      errorName: error.name,
      stack: error.stack,
      context,
      ...additionalData
    };

    switch (severity) {
      case 'debug':
        logger.debug('Error logged', logData);
        break;
      case 'info':
        logger.info('Error logged', logData);
        break;
      case 'warn':
        logger.warn('Error logged', logData);
        break;
      case 'error':
      default:
        logger.error('Error logged', logData);
        break;
    }
  }

  /**
   * Get appropriate error code for routing errors.
   */
  private getErrorCodeForRoutingError(error: RoutingError): number {
    if (error.message.includes('Invalid routing strategy')) {
      return -32602; // Invalid params
    }
    if (error.message.includes('Server not found')) {
      return -32601; // Method not found
    }
    if (error.message.includes('No route found')) {
      return -32601; // Method not found
    }
    return -32603; // Internal error
  }

  /**
   * Get appropriate error code for downstream errors.
   */
  private getErrorCodeForDownstreamError(error: DownstreamError): number {
    if (error.statusCode) {
      if (error.statusCode >= 400 && error.statusCode < 500) {
        return -32602; // Invalid params (client error)
      }
      if (error.statusCode >= 500) {
        return -32603; // Internal error (server error)
      }
    }
    return -32603; // Internal error (default)
  }

  /**
   * Format routing error message for user consumption.
   */
  private formatRoutingErrorMessage(error: RoutingError): string {
    if (error.message.includes('No route found')) {
      return `No routing rule found for the request. Please check the request path or headers.`;
    }
    if (error.message.includes('Server not found')) {
      return `The target server is not configured. Please check the server configuration.`;
    }
    if (error.message.includes('Invalid routing strategy')) {
      return `Invalid routing configuration. Please check the proxy configuration.`;
    }
    return `Routing error: ${error.message}`;
  }

  /**
   * Format downstream error message for user consumption.
   */
  private formatDownstreamErrorMessage(error: DownstreamError): string {
    if (error.statusCode) {
      if (error.statusCode === 404) {
        return `The requested resource was not found on server '${error.serverName}'.`;
      }
      if (error.statusCode === 401 || error.statusCode === 403) {
        return `Authentication or authorization failed for server '${error.serverName}'.`;
      }
      if (error.statusCode >= 500) {
        return `Server '${error.serverName}' is experiencing internal issues.`;
      }
      return `Server '${error.serverName}' returned error ${error.statusCode}: ${error.message}`;
    }
    return `Failed to communicate with server '${error.serverName}': ${error.message}`;
  }

  /**
   * Format protocol error message for user consumption.
   */
  private formatProtocolErrorMessage(error: Error): string {
    if (error.message.includes('timeout')) {
      return 'Request timed out while processing.';
    }
    if (error.message.includes('network') || error.message.includes('connection')) {
      return 'Network connection error occurred.';
    }
    if (error.message.includes('parse') || error.message.includes('JSON')) {
      return 'Invalid request or response format.';
    }
    return `Internal processing error: ${error.message}`;
  }

  /**
   * Check if an error should be retried.
   */
  isRetryableError(error: Error): boolean {
    if (error instanceof DownstreamError) {
      // Retry on 5xx server errors and network issues
      return !error.statusCode || error.statusCode >= 500;
    }
    
    // Retry on network/timeout errors
    const retryableMessages = [
      'timeout',
      'network',
      'connection',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT'
    ];
    
    return retryableMessages.some(msg => 
      error.message.toLowerCase().includes(msg.toLowerCase())
    );
  }

  /**
   * Get retry delay based on attempt number (exponential backoff).
   */
  getRetryDelay(attempt: number, baseDelay: number = 1000): number {
    return Math.min(baseDelay * Math.pow(2, attempt - 1), 30000); // Max 30 seconds
  }

  /**
   * Sanitize error data to prevent sensitive information leakage.
   */
  sanitizeErrorData(data: any): any {
    const sensitiveKeys = [
      'password', 'token', 'key', 'secret', 'auth', 'credential',
      'api_key', 'access_token', 'refresh_token', 'authorization'
    ];
    
    if (typeof data !== 'object' || data === null) {
      return data;
    }
    
    const sanitized = { ...data };
    
    for (const key in sanitized) {
      if (sensitiveKeys.some(sensitive => 
        key.toLowerCase().includes(sensitive.toLowerCase())
      )) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof sanitized[key] === 'object') {
        sanitized[key] = this.sanitizeErrorData(sanitized[key]);
      }
    }
    
    return sanitized;
  }
}