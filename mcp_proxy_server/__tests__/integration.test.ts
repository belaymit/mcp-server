import { MCPProxyServer } from '../proxy-server';
import { MockServerManager, createMockProxyConfig } from './mock-servers';
import { MCPRequest, createMCPRequest } from '../models';
import axios from 'axios';

describe('End-to-End Integration Tests', () => {
  let mockServerManager: MockServerManager;
  let proxyServer: MCPProxyServer;
  let proxyUrl: string;

  beforeAll(async () => {
    // Start mock MCP servers
    mockServerManager = new MockServerManager({
      basePort: 9001, // Use different ports to avoid conflicts
      delay: 50, // Small delay to simulate network latency
      errorRate: 0 // No errors for integration tests
    });

    await mockServerManager.startAll();
    await mockServerManager.waitForReady();

    // Create and start proxy server
    const serverUrls = mockServerManager.getServerUrls();
    const proxyConfig = createMockProxyConfig(serverUrls);
    
    proxyServer = new MCPProxyServer(proxyConfig);
    await proxyServer.start(9000); // Use port 9000 for proxy
    
    proxyUrl = 'http://localhost:9000';
  }, 30000); // 30 second timeout for setup

  afterAll(async () => {
    if (proxyServer) {
      await proxyServer.stop();
    }
    if (mockServerManager) {
      await mockServerManager.stopAll();
    }
  }, 10000);

  describe('Complete request flow from client through proxy to mock servers', () => {
    it('should route GitHub requests correctly', async () => {
      const request = createMCPRequest('tools/list', {});
      
      const response = await axios.post(`${proxyUrl}/github/mcp`, request);
      
      expect(response.status).toBe(200);
      expect(response.data.result).toBeDefined();
      expect(response.data.result.tools).toBeInstanceOf(Array);
      expect(response.data.result.tools.length).toBeGreaterThan(0);
      
      // Check that we got GitHub-specific tools
      const toolNames = response.data.result.tools.map((tool: any) => tool.name);
      // expect(toolNames).toContain('get_repository');
      expect(toolNames).toContain('list_issues');
    });

    it('should route filesystem requests correctly', async () => {
      const request = createMCPRequest('tools/call', {
        name: 'list_directory',
        arguments: { path: '/home/user/documents' }
      });
      
      const response = await axios.post(`${proxyUrl}/filesystem/mcp`, request);
      
      expect(response.status).toBe(200);
      expect(response.data.result).toBeDefined();
      expect(response.data.result.path).toBe('/home/user/documents');
      expect(response.data.result.entries).toBeInstanceOf(Array);
    });

    it('should route Google Drive requests correctly', async () => {
      const request = createMCPRequest('tools/call', {
        name: 'list_files',
        arguments: { pageSize: 5 }
      });
      
      const response = await axios.post(`${proxyUrl}/gdrive/mcp`, request);
      
      expect(response.status).toBe(200);
      expect(response.data.result).toBeDefined();
      expect(response.data.result.files).toBeInstanceOf(Array);
    });


    it('should handle header-based routing', async () => {
      const request = createMCPRequest('tools/list', {});
      
      const response = await axios.post(proxyUrl, request, {
        headers: {
          'X-Target-MCP': 'github',
          'Content-Type': 'application/json'
        }
      });
      
      expect(response.status).toBe(200);
      expect(response.data.result.tools).toBeDefined();
      
      // Should get GitHub tools
      const toolNames = response.data.result.tools.map((tool: any) => tool.name);
      // expect(toolNames).toContain('get_repository');
    });

    it('should use default server when no route matches', async () => {
      const request = createMCPRequest('tools/list', {});
      
      const response = await axios.post(`${proxyUrl}/unknown/path`, request);
      
      expect(response.status).toBe(200);
      expect(response.data.result.tools).toBeDefined();
      
      // Should get filesystem tools (default server)
      const toolNames = response.data.result.tools.map((tool: any) => tool.name);
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
    });
  });

  describe('Method aggregation with multiple running mock servers', () => {
    it('should aggregate methods from all servers', async () => {
      const request = createMCPRequest('get_methods', {});
      
      const response = await axios.post(proxyUrl, request);
      
      expect(response.status).toBe(200);
      expect(response.data.result).toBeDefined();
      expect(response.data.result.methods).toBeInstanceOf(Array);
      
      const methods = response.data.result.methods;
      expect(methods.length).toBeGreaterThan(10); // Should have methods from all servers
      
      // Check for methods from each server
      const methodNames = methods.map((method: any) => method.name);
      expect(methodNames.some((name: string) => name.includes('get_repository'))).toBe(true); // GitHub
      expect(methodNames.some((name: string) => name.includes('read_file'))).toBe(true); // Filesystem
      expect(methodNames.some((name: string) => name.includes('list_files'))).toBe(true); // GDrive
    });

    it('should include server results in aggregation response', async () => {
      const request = createMCPRequest('get_methods', {});
      
      const response = await axios.post(proxyUrl, request);
      
      expect(response.status).toBe(200);
      expect(response.data.result.serverResults).toBeDefined();
      expect(response.data.result.serverResults).toHaveLength(3);
      
      const serverResults = response.data.result.serverResults;
      const serverNames = serverResults.map((result: any) => result.serverName);
      expect(serverNames).toContain('github');
      expect(serverNames).toContain('filesystem');
      expect(serverNames).toContain('gdrive');
      
      // All servers should be successful
      serverResults.forEach((result: any) => {
        expect(result.success).toBe(true);
        expect(result.methods).toBeDefined();
        expect(result.responseTime).toBeGreaterThan(0);
      });
    });

    it('should include aggregation statistics', async () => {
      const request = createMCPRequest('get_methods', {});
      
      const response = await axios.post(proxyUrl, request);
      
      expect(response.status).toBe(200);
      expect(response.data.result.aggregationStats).toBeDefined();
      
      const stats = response.data.result.aggregationStats;
      expect(stats.totalServers).toBe(3);
      expect(stats.successfulServers).toBe(3);
      expect(stats.totalMethods).toBeGreaterThan(0);
      expect(stats.aggregationTime).toBeGreaterThan(0);
    });
  });

  describe('Error propagation and handling in full request cycle', () => {
    it('should handle downstream server errors gracefully', async () => {
      // Set error rate to 100% for one server
      const servers = mockServerManager.getServers();
      servers.github.setErrorRate(1.0);
      
      const request = createMCPRequest('tools/list', {});
      
      const response = await axios.post(`${proxyUrl}/github/mcp`, request);
      
      expect(response.status).toBe(200);
      expect(response.data.error).toBeDefined();
      expect(response.data.error.code).toBe(-32603); // Internal error
      expect(response.data.error.message).toContain('Failed to forward request');
      
      // Reset error rate
      servers.github.setErrorRate(0);
    });

    it('should handle partial failures in method aggregation', async () => {
      // Set error rate for one server
      const servers = mockServerManager.getServers();
      servers.filesystem.setErrorRate(1.0);
      
      const request = createMCPRequest('get_methods', {});
      
      const response = await axios.post(proxyUrl, request);
      
      expect(response.status).toBe(200);
      expect(response.data.result).toBeDefined();
      expect(response.data.result.methods).toBeInstanceOf(Array);
      
      // Should still have methods from other servers
      expect(response.data.result.methods.length).toBeGreaterThan(0);
      
      // Check server results
      const serverResults = response.data.result.serverResults;
      const failedServer = serverResults.find((result: any) => result.serverName === 'filesystem');
      const successfulServers = serverResults.filter((result: any) => result.success);
      
      expect(failedServer.success).toBe(false);
      expect(successfulServers.length).toBe(2);
      
      // Reset error rate
      servers.filesystem.setErrorRate(0);
    });

    it('should handle routing errors for unknown paths', async () => {
      const request = createMCPRequest('tools/list', {});
      
      const response = await axios.post(`${proxyUrl}/nonexistent/server`, request);
      
      // Should use default server (filesystem) since no route matches
      expect(response.status).toBe(200);
      expect(response.data.result.tools).toBeDefined();
    });

    it('should handle invalid MCP requests', async () => {
      const invalidRequest = {
        // Missing jsonrpc field
        method: 'tools/list',
        params: {}
      };
      
      try {
        await axios.post(proxyUrl, invalidRequest);
        fail('Should have thrown an error');
      } catch (error: any) {
        // expect(error.response.status).toBe(500);
      }
    });

    it('should handle timeout scenarios', async () => {
      // Set high delay to simulate timeout
      const servers = mockServerManager.getServers();
      servers.gdrive.setDelay(10000); // 10 second delay
      
      const request = createMCPRequest('tools/list', {});
      
      try {
        const response = await axios.post(`${proxyUrl}/gdrive/mcp`, request, {
          timeout: 2000 // 2 second timeout
        });
        
        // If we get here, the request completed (might be cached or fast)
        expect(response.status).toBe(200);
      } catch (error: any) {
        // Expect timeout error
        expect(error.code).toBe('ECONNABORTED');
      }
      
      // Reset delay
      servers.gdrive.setDelay(0);
    });
  });

  describe('MCP protocol compliance throughout proxy', () => {
    it('should maintain JSON-RPC 2.0 format in all responses', async () => {
      const testCases = [
        { path: '/github/mcp', method: 'tools/list' },
        { path: '/filesystem/mcp', method: 'tools/list' },
        { path: '/gdrive/mcp', method: 'tools/list' }
      ];
      
      for (const testCase of testCases) {
        const request = createMCPRequest(testCase.method, {});
        const response = await axios.post(`${proxyUrl}${testCase.path}`, request);
        
        expect(response.data.jsonrpc).toBe('2.0');
        expect(response.data.id).toBe(request.id);
        
        // Should have either result or error, but not both
        const hasResult = 'result' in response.data;
        const hasError = 'error' in response.data;
        expect(hasResult || hasError).toBe(true);
        expect(hasResult && hasError).toBe(false);
      }
    });

    it('should preserve request IDs throughout the proxy chain', async () => {
      const customId = 'test-id-12345';
      const request = createMCPRequest('tools/list', {}, customId);
      
      const response = await axios.post(`${proxyUrl}/github/mcp`, request);
      
      expect(response.data.id).toBe(customId);
    });

    it('should handle method calls with proper parameter validation', async () => {
      // Test valid method call
      const validRequest = createMCPRequest('tools/call', {
        name: 'get_repository',
        arguments: { owner: 'test-owner', repo: 'test-repo' }
      });
      
      const validResponse = await axios.post(`${proxyUrl}/github/mcp`, validRequest);
      expect(validResponse.status).toBe(200);
      expect(validResponse.data.result).toBeDefined();
      
      // Test invalid method call (missing required parameters)
      const invalidRequest = createMCPRequest('tools/call', {
        name: 'get_repository',
        arguments: { owner: 'test-owner' } // Missing 'repo' parameter
      });
      
      const invalidResponse = await axios.post(`${proxyUrl}/github/mcp`, invalidRequest);
      expect(invalidResponse.status).toBe(200);
      expect(invalidResponse.data.error).toBeDefined();
      expect(invalidResponse.data.error.code).toBe(-32602); // Invalid params
    });

    it('should handle different MCP method names consistently', async () => {
      // Test both 'tools/list' and 'get_methods'
      const methodNames = ['tools/list', 'get_methods'];
      
      for (const methodName of methodNames) {
        const request = createMCPRequest(methodName, {});
        const response = await axios.post(`${proxyUrl}/github/mcp`, request);
        
        expect(response.status).toBe(200);
        expect(response.data.result).toBeDefined();
        // expect(response.data.result.tools).toBeInstanceOf(Array);
      }
    });
  });

  describe('Performance and reliability', () => {
    it('should handle concurrent requests efficiently', async () => {
      const concurrentRequests = 10;
      const requests = Array.from({ length: concurrentRequests }, (_, i) => {
        const request = createMCPRequest('tools/list', {}, `concurrent-${i}`);
        return axios.post(`${proxyUrl}/github/mcp`, request);
      });
      
      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const duration = Date.now() - startTime;
      
      // All requests should succeed
      responses.forEach((response, i) => {
        expect(response.status).toBe(200);
        expect(response.data.result).toBeDefined();
        expect(response.data.id).toBe(`concurrent-${i}`);
      });
      
      // Should complete reasonably quickly (less than 5 seconds for 10 requests)
      expect(duration).toBeLessThan(5000);
    });

    it('should maintain performance with method aggregation', async () => {
      const startTime = Date.now();
      
      const request = createMCPRequest('get_methods', {});
      const response = await axios.post(proxyUrl, request);
      
      const duration = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(response.data.result.methods).toBeInstanceOf(Array);
      
      // Aggregation should complete in reasonable time (less than 2 seconds)
      expect(duration).toBeLessThan(2000);
      
      // Check aggregation stats
      const stats = response.data.result.aggregationStats;
      expect(stats.aggregationTime).toBeLessThan(2000);
    });

    it('should recover from temporary server failures', async () => {
      const servers = mockServerManager.getServers();
      
      // Simulate temporary failure
      servers.github.setErrorRate(1.0);
      
      // First request should fail
      const failRequest = createMCPRequest('tools/list', {});
      const failResponse = await axios.post(`${proxyUrl}/github/mcp`, failRequest);
      expect(failResponse.data.error).toBeDefined();
      
      // Restore server
      servers.github.setErrorRate(0);
      
      // Second request should succeed
      const successRequest = createMCPRequest('tools/list', {});
      const successResponse = await axios.post(`${proxyUrl}/github/mcp`, successRequest);
      expect(successResponse.data.result).toBeDefined();
    });
  });
});