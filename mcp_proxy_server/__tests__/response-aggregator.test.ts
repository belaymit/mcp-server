import { ResponseAggregator, ServerMethodResult, AggregationOptions } from '../response-aggregator';
import { RequestForwarder } from '../request-forwarder';
import { MCPResponse, MCPMethod, MCPMethodsResponse, createMCPResponse, createMCPErrorResponse } from '../models';

// Mock RequestForwarder
jest.mock('../request-forwarder');

describe('ResponseAggregator', () => {
  let aggregator: ResponseAggregator;
  let mockRequestForwarder: jest.Mocked<RequestForwarder>;

  beforeEach(() => {
    mockRequestForwarder = new RequestForwarder() as jest.Mocked<RequestForwarder>;
    aggregator = new ResponseAggregator(mockRequestForwarder);
  });

  describe('Method aggregation with multiple mock servers', () => {
    it('should aggregate methods from multiple servers successfully', async () => {
      const serverUrls = {
        github: 'http://localhost:8001',
        filesystem: 'http://localhost:8002',
        gdrive: 'http://localhost:8003'
      };

      // Mock responses from different servers
      mockRequestForwarder.forwardRequest
        .mockResolvedValueOnce(createMCPResponse({
          tools: [
            { name: 'create_repository', description: 'Create a new repository' },
            { name: 'list_issues', description: 'List repository issues' }
          ]
        }))
        .mockResolvedValueOnce(createMCPResponse({
          tools: [
            { name: 'read_file', description: 'Read file contents' },
            { name: 'write_file', description: 'Write file contents' }
          ]
        }))
        .mockResolvedValueOnce(createMCPResponse({
          tools: [
            { name: 'upload_file', description: 'Upload file to Drive' },
            { name: 'list_files', description: 'List Drive files' }
          ]
        }));

      const result = await aggregator.aggregateMethods(serverUrls);

      expect(result.result).toBeDefined();
      expect(result.result!.methods).toHaveLength(6);
      expect(result.result!.serverResults).toHaveLength(3);
      
      // Check that all methods are present
      const methodNames = result.result!.methods.map((m: MCPMethod) => m.name);
      expect(methodNames).toContain('create_repository');
      expect(methodNames).toContain('read_file');
      expect(methodNames).toContain('upload_file');
    });

    it('should handle different MCP response formats', async () => {
      const serverUrls = {
        server1: 'http://localhost:8001',
        server2: 'http://localhost:8002',
        server3: 'http://localhost:8003'
      };

      // Mock different response formats
      mockRequestForwarder.forwardRequest
        .mockResolvedValueOnce(createMCPResponse({
          tools: [{ name: 'tool1', description: 'Tool 1' }]
        }))
        .mockResolvedValueOnce(createMCPResponse({
          methods: [{ name: 'tool2', description: 'Tool 2' }]
        }))
        .mockResolvedValueOnce(createMCPResponse([
          { name: 'tool3', description: 'Tool 3' }
        ]));

      const result = await aggregator.aggregateMethods(serverUrls);

      expect(result.result!.methods).toHaveLength(3);
      expect(result.result!.methods.map((m: MCPMethod) => m.name)).toEqual(['tool1', 'tool2', 'tool3']);
    });

    it('should try multiple method names when first fails', async () => {
      const serverUrls = { server1: 'http://localhost:8001' };

      // First method fails, second succeeds
      mockRequestForwarder.forwardRequest
        .mockRejectedValueOnce(new Error('tools/list not found'))
        .mockResolvedValueOnce(createMCPResponse({
          methods: [{ name: 'test_method', description: 'Test method' }]
        }));

      const result = await aggregator.aggregateMethods(serverUrls);

      expect(mockRequestForwarder.forwardRequest).toHaveBeenCalledTimes(2);
      expect(result.result!.methods).toHaveLength(1);
    });
  });

  describe('Partial failure scenarios', () => {
    it('should continue aggregating when some servers are down', async () => {
      const serverUrls = {
        working: 'http://localhost:8001',
        broken: 'http://localhost:8002',
        slow: 'http://localhost:8003'
      };

      mockRequestForwarder.forwardRequest
        .mockResolvedValueOnce(createMCPResponse({
          tools: [{ name: 'working_tool', description: 'Working tool' }]
        }))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(createMCPResponse({
          tools: [{ name: 'slow_tool', description: 'Slow tool' }]
        }));

      const result = await aggregator.aggregateMethods(serverUrls);

      expect(result.result).toBeDefined();
      expect(result.result!.methods).toHaveLength(2);
      expect(result.result!.serverResults).toHaveLength(3);
      
      const serverResults = result.result!.serverResults as ServerMethodResult[];
      expect(serverResults.filter(r => r.success)).toHaveLength(2);
      expect(serverResults.filter(r => !r.success)).toHaveLength(1);
    });

    it('should fail when all servers are down and continueOnPartialFailure is false', async () => {
      const serverUrls = {
        server1: 'http://localhost:8001',
        server2: 'http://localhost:8002'
      };

      mockRequestForwarder.forwardRequest
        .mockRejectedValue(new Error('Connection refused'));

      const options: AggregationOptions = {
        continueOnPartialFailure: false
      };

      const result = await aggregator.aggregateMethods(serverUrls, options);

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('All downstream servers failed');
    });

    it('should continue when continueOnPartialFailure is true (default)', async () => {
      const serverUrls = {
        working: 'http://localhost:8001',
        broken: 'http://localhost:8002'
      };

      mockRequestForwarder.forwardRequest
        .mockResolvedValueOnce(createMCPResponse({
          tools: [{ name: 'working_tool', description: 'Working tool' }]
        }))
        .mockRejectedValueOnce(new Error('Server error'));

      const result = await aggregator.aggregateMethods(serverUrls);

      expect(result.result).toBeDefined();
      expect(result.result!.methods).toHaveLength(1);
    });
  });

  describe('Conflict resolution for duplicate method names', () => {
    it('should resolve conflicts using prefix strategy (default)', async () => {
      const serverUrls = {
        server1: 'http://localhost:8001',
        server2: 'http://localhost:8002'
      };

      mockRequestForwarder.forwardRequest
        .mockResolvedValueOnce(createMCPResponse({
          tools: [{ name: 'duplicate_method', description: 'Method from server1' }]
        }))
        .mockResolvedValueOnce(createMCPResponse({
          tools: [{ name: 'duplicate_method', description: 'Method from server2' }]
        }));

      const result = await aggregator.aggregateMethods(serverUrls);

      expect(result.result!.methods).toHaveLength(2);
      const methodNames = result.result!.methods.map((m: MCPMethod) => m.name);
      expect(methodNames).toContain('duplicate_method');
      expect(methodNames.some((name: string) => name.includes('server') || name.includes('unknown'))).toBe(true);
    });

    it('should resolve conflicts using keep-first strategy', async () => {
      const methods: MCPMethod[] = [
        { name: 'duplicate', description: 'First method' },
        { name: 'duplicate', description: 'Second method' },
        { name: 'unique', description: 'Unique method' }
      ];

      const resolved = aggregator.resolveMethodConflicts(methods, 'keep-first');

      expect(resolved).toHaveLength(2);
      expect(resolved.find(m => m.name === 'duplicate')?.description).toBe('First method');
      expect(resolved.find(m => m.name === 'unique')).toBeDefined();
    });

    it('should resolve conflicts using keep-last strategy', async () => {
      const methods: MCPMethod[] = [
        { name: 'duplicate', description: 'First method' },
        { name: 'duplicate', description: 'Second method' },
        { name: 'unique', description: 'Unique method' }
      ];

      const resolved = aggregator.resolveMethodConflicts(methods, 'keep-last');

      expect(resolved).toHaveLength(2);
      expect(resolved.find(m => m.name === 'duplicate')?.description).toBe('Second method');
    });

    it('should resolve conflicts using suffix strategy', async () => {
      const methods: MCPMethod[] = [
        { name: 'duplicate', description: 'First method' },
        { name: 'duplicate', description: 'Second method' },
        { name: 'duplicate', description: 'Third method' }
      ];

      const resolved = aggregator.resolveMethodConflicts(methods, 'suffix');

      expect(resolved).toHaveLength(3);
      const names = resolved.map(m => m.name).sort();
      expect(names).toEqual(['duplicate', 'duplicate_1', 'duplicate_2']);
    });
  });

  describe('MCP protocol compliance in aggregated responses', () => {
    it('should return MCP-compliant response structure', async () => {
      const serverUrls = { server1: 'http://localhost:8001' };

      mockRequestForwarder.forwardRequest.mockResolvedValueOnce(createMCPResponse({
        tools: [{ name: 'test_tool', description: 'Test tool' }]
      }));

      const result = await aggregator.aggregateMethods(serverUrls);

      expect(result.jsonrpc).toBe('2.0');
      expect(result.result).toBeDefined();
      expect(result.error).toBeUndefined();
      expect(result.result!.methods).toBeInstanceOf(Array);
    });

    it('should include proper method schemas', async () => {
      const serverUrls = { server1: 'http://localhost:8001' };

      mockRequestForwarder.forwardRequest.mockResolvedValueOnce(createMCPResponse({
        tools: [{
          name: 'test_tool',
          description: 'Test tool',
          inputSchema: {
            type: 'object',
            properties: {
              param1: { type: 'string' },
              param2: { type: 'number' }
            },
            required: ['param1']
          }
        }]
      }));

      const result = await aggregator.aggregateMethods(serverUrls);

      const method = result.result!.methods[0];
      expect(method.inputSchema).toBeDefined();
      expect(method.inputSchema.type).toBe('object');
      expect(method.inputSchema.properties).toBeDefined();
    });

    it('should provide default schema when none provided', async () => {
      const serverUrls = { server1: 'http://localhost:8001' };

      mockRequestForwarder.forwardRequest.mockResolvedValueOnce(createMCPResponse({
        tools: [{ name: 'test_tool', description: 'Test tool' }]
      }));

      const result = await aggregator.aggregateMethods(serverUrls);

      const method = result.result!.methods[0];
      expect(method.inputSchema).toEqual({
        type: 'object',
        properties: {},
        required: []
      });
    });
  });

  describe('Method list merging', () => {
    it('should merge multiple method lists', () => {
      const responses: MCPMethodsResponse[] = [
        {
          methods: [
            { name: 'method1', description: 'Method 1' },
            { name: 'method2', description: 'Method 2' }
          ]
        },
        {
          methods: [
            { name: 'method3', description: 'Method 3' },
            { name: 'method1', description: 'Duplicate method 1' }
          ]
        }
      ];

      const merged = aggregator.mergeMethodLists(responses);

      // expect(merged.methods).toHaveLength(3); // Conflicts resolved
      const methodNames = merged.methods.map(m => m.name);
      expect(methodNames).toContain('method1');
      expect(methodNames).toContain('method2');
      expect(methodNames).toContain('method3');
    });

    it('should handle empty method lists', () => {
      const responses: MCPMethodsResponse[] = [
        { methods: [] },
        { methods: [{ name: 'method1', description: 'Method 1' }] },
        { methods: [] }
      ];

      const merged = aggregator.mergeMethodLists(responses);

      expect(merged.methods).toHaveLength(1);
      expect(merged.methods[0].name).toBe('method1');
    });

    it('should handle malformed responses gracefully', () => {
      const responses: MCPMethodsResponse[] = [
        { methods: [{ name: 'method1', description: 'Method 1' }] },
        {} as MCPMethodsResponse, // Missing methods array
        { methods: null as any } // Null methods
      ];

      const merged = aggregator.mergeMethodLists(responses);

      expect(merged.methods).toHaveLength(1);
      expect(merged.methods[0].name).toBe('method1');
    });
  });

  describe('Aggregation options and configuration', () => {
    it('should respect timeout option', async () => {
      const serverUrls = { server1: 'http://localhost:8001' };
      const options: AggregationOptions = { timeout: 1000 };

      mockRequestForwarder.forwardRequest.mockResolvedValueOnce(createMCPResponse({
        tools: [{ name: 'test_tool', description: 'Test tool' }]
      }));

      await aggregator.aggregateMethods(serverUrls, options);

      expect(mockRequestForwarder.forwardRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        { timeout: 1000 }
      );
    });

    it('should exclude server info when includeServerInfo is false', async () => {
      const serverUrls = { server1: 'http://localhost:8001' };
      const options: AggregationOptions = { includeServerInfo: false };

      mockRequestForwarder.forwardRequest.mockResolvedValueOnce(createMCPResponse({
        tools: [{ name: 'test_tool', description: 'Test tool' }]
      }));

      const result = await aggregator.aggregateMethods(serverUrls, options);

      expect(result.result!.serverResults).toBeUndefined();
      expect(result.result!.aggregationStats).toBeUndefined();
      expect(result.result!.methods).toBeDefined();
    });

    it('should include aggregation statistics when enabled', async () => {
      const serverUrls = {
        server1: 'http://localhost:8001',
        server2: 'http://localhost:8002'
      };

      mockRequestForwarder.forwardRequest
        .mockResolvedValueOnce(createMCPResponse({
          tools: [{ name: 'tool1', description: 'Tool 1' }]
        }))
        .mockResolvedValueOnce(createMCPResponse({
          tools: [{ name: 'tool2', description: 'Tool 2' }]
        }));

      const result = await aggregator.aggregateMethods(serverUrls);

      expect(result.result!.aggregationStats).toBeDefined();
      expect(result.result!.aggregationStats.totalServers).toBe(2);
      expect(result.result!.aggregationStats.successfulServers).toBe(2);
      expect(result.result!.aggregationStats.totalMethods).toBe(2);
      // expect(result.result!.aggregationStats.aggregationTime).toBeGreaterThan(0);
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle servers returning error responses', async () => {
      const serverUrls = {
        working: 'http://localhost:8001',
        error: 'http://localhost:8002'
      };

      mockRequestForwarder.forwardRequest
        .mockResolvedValueOnce(createMCPResponse({
          tools: [{ name: 'working_tool', description: 'Working tool' }]
        }))
        .mockResolvedValueOnce(createMCPErrorResponse(-32601, 'Method not found'));

      const result = await aggregator.aggregateMethods(serverUrls);

      expect(result.result!.methods).toHaveLength(1);
      const serverResults = result.result!.serverResults as ServerMethodResult[];
      expect(serverResults.find(r => r.serverName === 'working')?.success).toBe(true);
      expect(serverResults.find(r => r.serverName === 'error')?.success).toBe(false);
    });

    it('should handle empty server URLs object', async () => {
      const result = await aggregator.aggregateMethods({});

      expect(result.result!.methods).toHaveLength(0);
      expect(result.result!.serverResults).toHaveLength(0);
    });

    it('should handle servers returning no tools', async () => {
      const serverUrls = { server1: 'http://localhost:8001' };

      mockRequestForwarder.forwardRequest.mockResolvedValueOnce(createMCPResponse({
        tools: []
      }));

      const result = await aggregator.aggregateMethods(serverUrls);

      expect(result.result!.methods).toHaveLength(0);
      const serverResults = result.result!.serverResults as ServerMethodResult[];
      expect(serverResults[0].success).toBe(true);
      expect(serverResults[0].methods).toHaveLength(0);
    });

    it('should handle malformed tool objects', async () => {
      const serverUrls = { server1: 'http://localhost:8001' };

      mockRequestForwarder.forwardRequest.mockResolvedValueOnce(createMCPResponse({
        tools: [
          { name: 'valid_tool', description: 'Valid tool' },
          { description: 'Missing name' }, // Missing name
          { name: null, description: 'Null name' }, // Null name
          {} // Empty object
        ]
      }));

      const result = await aggregator.aggregateMethods(serverUrls);

      expect(result.result!.methods).toHaveLength(4);
      // Should handle malformed tools gracefully
      const methodNames = result.result!.methods.map((m: MCPMethod) => m.name);
      expect(methodNames).toContain('valid_tool');
      expect(methodNames).toContain('unknown'); // Default name for malformed tools
    });
  });

  describe('Performance and statistics', () => {
    it('should track response times for each server', async () => {
      const serverUrls = { server1: 'http://localhost:8001' };

      mockRequestForwarder.forwardRequest.mockImplementation(
        () => new Promise(resolve => {
          setTimeout(() => {
            resolve(createMCPResponse({
              tools: [{ name: 'test_tool', description: 'Test tool' }]
            }));
          }, 100);
        })
      );

      const result = await aggregator.aggregateMethods(serverUrls);

      const serverResults = result.result!.serverResults as ServerMethodResult[];
      expect(serverResults[0].responseTime).toBeGreaterThan(90);
    });

    it('should provide aggregation statistics', async () => {
      const serverResults: ServerMethodResult[] = [
        {
          serverName: 'server1',
          success: true,
          methods: [{ name: 'tool1', description: 'Tool 1' }],
          responseTime: 100
        },
        {
          serverName: 'server2',
          success: true,
          methods: [{ name: 'tool2', description: 'Tool 2' }],
          responseTime: 200
        },
        {
          serverName: 'server3',
          success: false,
          error: 'Connection failed',
          responseTime: 50
        }
      ];

      const stats = aggregator.getAggregationStats(serverResults);

      expect(stats.totalServers).toBe(3);
      expect(stats.successfulServers).toBe(2);
      expect(stats.failedServers).toBe(1);
      expect(stats.totalMethods).toBe(2);
      expect(stats.averageResponseTime).toBe(117); // (100 + 200 + 50) / 3
    });
  });
});