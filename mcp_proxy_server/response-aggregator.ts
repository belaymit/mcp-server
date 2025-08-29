import { RequestForwarder } from './request-forwarder';
import { MCPResponse, MCPMethod, MCPMethodsResponse, createMCPResponse, createMCPErrorResponse } from './models';
import { createLogger } from './logger';

const logger = createLogger('response-aggregator');

export interface ServerMethodResult {
  serverName: string;
  success: boolean;
  methods?: MCPMethod[];
  error?: string;
  responseTime?: number;
}

export interface AggregationOptions {
  timeout?: number;
  includeServerInfo?: boolean;
  conflictResolution?: 'prefix' | 'suffix' | 'keep-first' | 'keep-last';
  continueOnPartialFailure?: boolean;
}

export class ResponseAggregator {
  private defaultOptions: AggregationOptions = {
    timeout: 30000,
    includeServerInfo: true,
    conflictResolution: 'prefix',
    continueOnPartialFailure: true
  };

  constructor(private requestForwarder: RequestForwarder) {
    logger.info('Response aggregator initialized');
  }

  /**
   * Aggregate get_methods responses from multiple servers.
   */
  async aggregateMethods(
    serverUrls: Record<string, string>, 
    options?: AggregationOptions
  ): Promise<MCPResponse> {
    const opts = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    
    logger.info(`Aggregating methods from ${Object.keys(serverUrls).length} servers`, {
      servers: Object.keys(serverUrls),
      options: opts
    });
    
    const serverResults: ServerMethodResult[] = [];
    const allMethods: MCPMethod[] = [];

    // Create promises for all server requests
    const serverPromises = Object.entries(serverUrls).map(async ([serverName, serverUrl]) => {
      return this.getMethodsFromServer(serverName, serverUrl, opts.timeout!);
    });

    // Wait for all requests to complete or timeout
    const results = await Promise.allSettled(serverPromises);
    
    // Process results
    for (let i = 0; i < results.length; i++) {
      const [serverName] = Object.entries(serverUrls)[i];
      const result = results[i];
      
      if (result.status === 'fulfilled') {
        serverResults.push(result.value);
        if (result.value.success && result.value.methods) {
          allMethods.push(...result.value.methods);
        }
      } else {
        logger.error(`Failed to get methods from ${serverName}:`, result.reason);
        serverResults.push({
          serverName,
          success: false,
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error'
        });
      }
    }

    // Check if we have any successful results
    const successfulResults = serverResults.filter(r => r.success);
    if (successfulResults.length === 0 && !opts.continueOnPartialFailure) {
      logger.error('All servers failed to respond');
      return createMCPErrorResponse(
        -32603,
        'All downstream servers failed to respond',
        undefined,
        { serverResults }
      );
    }

    // Resolve method conflicts
    const resolvedMethods = this.resolveMethodConflicts(allMethods, opts.conflictResolution!);
    
    const totalTime = Date.now() - startTime;
    logger.info(`Method aggregation completed`, {
      totalMethods: resolvedMethods.length,
      successfulServers: successfulResults.length,
      totalServers: Object.keys(serverUrls).length,
      duration: `${totalTime}ms`
    });
    
    const result: any = {
      methods: resolvedMethods
    };

    if (opts.includeServerInfo) {
      result.serverResults = serverResults;
      result.aggregationStats = {
        totalServers: Object.keys(serverUrls).length,
        successfulServers: successfulResults.length,
        totalMethods: resolvedMethods.length,
        aggregationTime: totalTime
      };
    }

    return createMCPResponse(result);
  }

  /**
   * Get methods from a single server.
   */
  private async getMethodsFromServer(
    serverName: string, 
    serverUrl: string, 
    timeout: number
  ): Promise<ServerMethodResult> {
    const startTime = Date.now();
    
    try {
      logger.debug(`Getting methods from ${serverName} at ${serverUrl}`);
      
      // Try different MCP method names that servers might use
      const methodNames = ['tools/list', 'get_methods', 'list_tools'];
      let response: MCPResponse | null = null;
      let lastError: Error | null = null;

      for (const methodName of methodNames) {
        try {
          const request = {
            jsonrpc: '2.0' as const,
            id: `get-methods-${serverName}-${Date.now()}`,
            method: methodName,
            params: {}
          };

          response = await this.requestForwarder.forwardRequest(serverUrl, request, { timeout });
          
          if (response.result) {
            break; // Success, exit the loop
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          continue; // Try next method name
        }
      }

      if (!response || response.error) {
        throw lastError || new Error(`No valid response from ${serverName}`);
      }

      // Extract methods from response
      const methods = this.extractMethodsFromResponse(response, serverName);
      const responseTime = Date.now() - startTime;
      
      logger.debug(`Successfully got ${methods.length} methods from ${serverName}`, {
        responseTime: `${responseTime}ms`
      });

      return {
        serverName,
        success: true,
        methods,
        responseTime
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.warn(`Failed to get methods from ${serverName}`, {
        error: errorMessage,
        responseTime: `${responseTime}ms`
      });

      return {
        serverName,
        success: false,
        error: errorMessage,
        responseTime
      };
    }
  }

  /**
   * Extract methods from MCP response, handling different response formats.
   */
  private extractMethodsFromResponse(response: MCPResponse, serverName: string): MCPMethod[] {
    if (!response.result) {
      return [];
    }

    const result = response.result;
    let tools: any[] = [];

    // Handle different response formats
    if (result.tools && Array.isArray(result.tools)) {
      tools = result.tools;
    } else if (result.methods && Array.isArray(result.methods)) {
      tools = result.methods;
    } else if (Array.isArray(result)) {
      tools = result;
    }

    return tools.map((tool: any) => ({
      name: tool.name || 'unknown',
      description: tool.description || `${tool.name || 'Tool'} from ${serverName} server`,
      inputSchema: tool.inputSchema || tool.parameters || tool.schema || {
        type: "object",
        properties: {},
        required: []
      }
    }));
  }

  /**
   * Merge method lists from multiple responses.
   */
  mergeMethodLists(responses: MCPMethodsResponse[]): MCPMethodsResponse {
    logger.info(`Merging ${responses.length} method lists`);
    
    const allMethods: MCPMethod[] = [];
    
    for (const response of responses) {
      if (response.methods && Array.isArray(response.methods)) {
        allMethods.push(...response.methods);
      }
    }
    
    const mergedMethods = this.resolveMethodConflicts(allMethods, 'prefix');
    
    logger.info(`Merged ${allMethods.length} methods into ${mergedMethods.length} unique methods`);
    
    return {
      methods: mergedMethods
    };
  }

  /**
   * Resolve conflicts when methods have the same name.
   */
  resolveMethodConflicts(
    methods: MCPMethod[], 
    strategy: 'prefix' | 'suffix' | 'keep-first' | 'keep-last' = 'prefix'
  ): MCPMethod[] {
    logger.debug(`Resolving conflicts for ${methods.length} methods using strategy: ${strategy}`);
    
    const methodMap = new Map<string, MCPMethod>();
    const conflicts: string[] = [];
    
    for (const method of methods) {
      const originalName = method.name;
      let finalName = originalName;
      
      // Handle conflicts based on strategy
      if (methodMap.has(originalName)) {
        conflicts.push(originalName);
        
        switch (strategy) {
          case 'prefix':
            // Extract server prefix if it exists
            const parts = originalName.split('/');
            if (parts.length > 1) {
              finalName = originalName; // Already has prefix
            } else {
              // Try to infer server from description or add generic prefix
              const serverMatch = method.description?.match(/from (\w+) server/);
              const serverName = serverMatch ? serverMatch[1] : 'unknown';
              finalName = `${serverName}/${originalName}`;
            }
            break;
            
          case 'suffix':
            let counter = 1;
            while (methodMap.has(`${originalName}_${counter}`)) {
              counter++;
            }
            finalName = `${originalName}_${counter}`;
            break;
            
          case 'keep-first':
            continue; // Skip this method, keep the first one
            
          case 'keep-last':
            // Will overwrite the existing one
            break;
        }
      }
      
      // Ensure the final name is unique
      let uniqueName = finalName;
      let counter = 1;
      while (methodMap.has(uniqueName) && uniqueName !== originalName) {
        uniqueName = `${finalName}_${counter}`;
        counter++;
      }
      
      methodMap.set(uniqueName, {
        ...method,
        name: uniqueName
      });
    }
    
    if (conflicts.length > 0) {
      logger.info(`Resolved ${conflicts.length} method name conflicts using ${strategy} strategy`, {
        conflicts: conflicts.slice(0, 10) // Log first 10 conflicts
      });
    }
    
    return Array.from(methodMap.values());
  }

  /**
   * Handle partial failures when some servers are unavailable.
   */
  handlePartialFailures(
    serverResults: ServerMethodResult[], 
    continueOnFailure: boolean = true
  ): { shouldContinue: boolean; errorMessage?: string } {
    const failedServers = serverResults.filter(r => !r.success);
    const successfulServers = serverResults.filter(r => r.success);
    
    if (failedServers.length === 0) {
      return { shouldContinue: true };
    }
    
    if (successfulServers.length === 0) {
      return {
        shouldContinue: false,
        errorMessage: 'All servers failed to respond'
      };
    }
    
    if (!continueOnFailure && failedServers.length > 0) {
      return {
        shouldContinue: false,
        errorMessage: `${failedServers.length} servers failed: ${failedServers.map(s => s.serverName).join(', ')}`
      };
    }
    
    logger.warn(`Continuing with partial results`, {
      successfulServers: successfulServers.length,
      failedServers: failedServers.length,
      failedServerNames: failedServers.map(s => s.serverName)
    });
    
    return { shouldContinue: true };
  }

  /**
   * Get aggregation statistics.
   */
  getAggregationStats(serverResults: ServerMethodResult[]): {
    totalServers: number;
    successfulServers: number;
    failedServers: number;
    averageResponseTime: number;
    totalMethods: number;
  } {
    const successfulResults = serverResults.filter(r => r.success);
    const totalMethods = successfulResults.reduce((sum, r) => sum + (r.methods?.length || 0), 0);
    const totalResponseTime = serverResults.reduce((sum, r) => sum + (r.responseTime || 0), 0);
    const averageResponseTime = serverResults.length > 0 ? totalResponseTime / serverResults.length : 0;
    
    return {
      totalServers: serverResults.length,
      successfulServers: successfulResults.length,
      failedServers: serverResults.length - successfulResults.length,
      averageResponseTime: Math.round(averageResponseTime),
      totalMethods
    };
  }
}