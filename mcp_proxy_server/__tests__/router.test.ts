import { Router, RoutingError } from '../router';
import { RoutingConfig, ServerConfig } from '../config';
import { MCPRequest } from '../models';

// Helper function to create test requests
const createRequest = (method: string, params?: any): MCPRequest => ({
  jsonrpc: '2.0',
  method,
  params: params || {},
  id: Math.random().toString()
});

describe('Router', () => {
  let router: Router;
  let servers: Record<string, ServerConfig>;
  let prefixConfig: RoutingConfig;
  let headerConfig: RoutingConfig;

  beforeEach(() => {
    servers = {
      github: {
        name: 'github',
        url: 'http://localhost:8001',
        timeout: 30,
        maxRetries: 3,
        healthCheckPath: '/health'
      },
      filesystem: {
        name: 'filesystem',
        url: 'http://localhost:8002',
        timeout: 15,
        maxRetries: 2,
        healthCheckPath: '/health'
      },
      gdrive: {
        name: 'gdrive',
        url: 'http://localhost:8003',
        timeout: 45,
        maxRetries: 3,
        healthCheckPath: '/health'
      }
    };

    prefixConfig = {
      strategy: 'prefix',
      rules: {
        github: 'github',
        fs: 'filesystem',
        filesystem: 'filesystem',
        gdrive: 'gdrive',
        drive: 'gdrive'
      },
      defaultServer: 'filesystem'
    };

    headerConfig = {
      strategy: 'header',
      rules: {
        github: 'github',
        filesystem: 'filesystem',
        gdrive: 'gdrive'
      }
    };
  });

  describe('Prefix-based routing', () => {
    beforeEach(() => {
      router = new Router(prefixConfig, servers);
    });

    it('should route request based on URL prefix', () => {
      const request = createRequest('tools/list');
      const requestPath = '/github/mcp/tools/list';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('github');
      expect(result.serverUrl).toBe('http://localhost:8001');
    });

    it('should route request with filesystem alias', () => {
      const request = createRequest('tools/list');
      const requestPath = '/fs/mcp/tools/list';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('filesystem');
      expect(result.serverUrl).toBe('http://localhost:8002');
    });

    it('should route request with gdrive alias', () => {
      const request = createRequest('invoke_method');
      const requestPath = '/drive/mcp/invoke';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('gdrive');
      expect(result.serverUrl).toBe('http://localhost:8003');
    });

    it('should use default server when no rule matches', () => {
      const request = createRequest('tools/list');
      const requestPath = '/unknown/method';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('filesystem');
      expect(result.serverUrl).toBe('http://localhost:8002');
    });

    it('should fail when no rule matches and no default server', () => {
      const configWithoutDefault = { ...prefixConfig, defaultServer: undefined };
      router = new Router(configWithoutDefault, servers);

      const request = createRequest('tools/list');
      const requestPath = '/unknown/method';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No route found');
    });

    it('should handle empty path gracefully', () => {
      const request = createRequest('tools/list');
      const requestPath = '';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('filesystem'); // Should use default
    });

    it('should handle root path gracefully', () => {
      const request = createRequest('tools/list');
      const requestPath = '/';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('filesystem'); // Should use default
    });

    it('should extract prefix from complex paths', () => {
      const request = createRequest('tools/list');
      const requestPath = '/github/api/v1/mcp/tools/list';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('github');
    });
  });

  describe('Header-based routing', () => {
    beforeEach(() => {
      router = new Router(headerConfig, servers);
    });

    it('should route request with X-Target-MCP header', () => {
      const request = createRequest('tools/list');
      const headers = { 'X-Target-MCP': 'github' };

      const result = router.routeRequest(request, undefined, headers);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('github');
      expect(result.serverUrl).toBe('http://localhost:8001');
    });

    it('should route request with x-target-mcp header (case insensitive)', () => {
      const request = createRequest('tools/list');
      const headers = { 'x-target-mcp': 'filesystem' };

      const result = router.routeRequest(request, undefined, headers);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('filesystem');
      expect(result.serverUrl).toBe('http://localhost:8002');
    });

    it('should route request with mixed case header', () => {
      const request = createRequest('invoke_method');
      const headers = { 'X-target-MCP': 'gdrive' };

      const result = router.routeRequest(request, undefined, headers);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('gdrive');
      expect(result.serverUrl).toBe('http://localhost:8003');
    });

    it('should fail when no headers provided', () => {
      const request = createRequest('tools/list');

      const result = router.routeRequest(request, undefined, undefined);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No route found');
    });

    it('should fail when no routing header found', () => {
      const request = createRequest('tools/list');
      const headers = { 'Content-Type': 'application/json' };

      const result = router.routeRequest(request, undefined, headers);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No route found');
    });

    it('should fail for unknown header value', () => {
      const configWithoutDefault = { ...headerConfig, defaultServer: undefined };
      router = new Router(configWithoutDefault, servers);

      const request = createRequest('tools/list');
      const headers = { 'X-Target-MCP': 'unknown' };

      const result = router.routeRequest(request, undefined, headers);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No route found');
    });

    it('should handle empty header value', () => {
      const request = createRequest('tools/list');
      const headers = { 'X-Target-MCP': '' };

      const result = router.routeRequest(request, undefined, headers);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No route found');
    });

    it('should use default server when header routing fails', () => {
      const configWithDefault = { ...headerConfig, defaultServer: 'filesystem' };
      router = new Router(configWithDefault, servers);

      const request = createRequest('tools/list');
      const headers = { 'Content-Type': 'application/json' };

      const result = router.routeRequest(request, undefined, headers);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('filesystem');
    });
  });

  describe('Error handling', () => {
    beforeEach(() => {
      router = new Router(prefixConfig, servers);
    });

    it('should handle invalid routing strategy gracefully', () => {
      const invalidConfig = { ...prefixConfig, strategy: 'invalid' as any };
      router = new Router(invalidConfig, servers);

      const request = createRequest('test');
      const requestPath = '/test/method';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid routing strategy');
    });

    it('should handle non-existent server gracefully', () => {
      const configWithBadRule = {
        ...prefixConfig,
        rules: { test: 'nonexistent' }
      };
      router = new Router(configWithBadRule, servers);

      const request = createRequest('test');
      const requestPath = '/test/method';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Server not found');
    });

    it('should handle unexpected errors gracefully', () => {
      // Create a router with valid config but then break it
      router = new Router(prefixConfig, servers);
      
      // Mock the getServerUrl method to throw an error
      const originalGetServerUrl = router.getServerUrl;
      router.getServerUrl = () => {
        throw new Error('Unexpected error');
      };

      const request = createRequest('test');
      const requestPath = '/github/method';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal routing error');

      // Restore original method
      router.getServerUrl = originalGetServerUrl;
    });
  });

  describe('Utility methods', () => {
    beforeEach(() => {
      router = new Router(prefixConfig, servers);
    });

    it('should get server URL', () => {
      expect(router.getServerUrl('github')).toBe('http://localhost:8001');
      expect(router.getServerUrl('filesystem')).toBe('http://localhost:8002');
    });

    it('should throw error for non-existent server URL', () => {
      expect(() => router.getServerUrl('nonexistent')).toThrow(RoutingError);
    });

    it('should get routing rules', () => {
      const rules = router.getRoutingRules();
      expect(rules.github).toBe('github');
      expect(rules.fs).toBe('filesystem');
    });

    it('should get routing strategy', () => {
      expect(router.getRoutingStrategy()).toBe('prefix');
    });

    it('should get default server', () => {
      expect(router.getDefaultServer()).toBe('filesystem');
    });

    it('should check if server exists', () => {
      expect(router.hasServer('github')).toBe(true);
      expect(router.hasServer('nonexistent')).toBe(false);
    });

    it('should get server names', () => {
      const serverNames = router.getServerNames();
      expect(serverNames).toContain('github');
      expect(serverNames).toContain('filesystem');
      expect(serverNames).toContain('gdrive');
      expect(serverNames).toHaveLength(3);
    });

    it('should reload configuration', () => {
      const newConfig = {
        strategy: 'header' as const,
        rules: { test: 'github' },
        defaultServer: undefined
      };
      const newServers = { github: servers.github };

      router.reloadConfig(newConfig, newServers);

      expect(router.getRoutingStrategy()).toBe('header');
      expect(router.getRoutingRules().test).toBe('github');
      expect(router.getServerNames()).toEqual(['github']);
    });

    it('should validate configuration', () => {
      const validation = router.validateConfig();
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect invalid configuration', () => {
      const invalidConfig = {
        ...prefixConfig,
        strategy: 'invalid' as any,
        rules: { test: 'nonexistent' },
        defaultServer: 'missing'
      };
      const invalidRouter = new Router(invalidConfig, servers);
      
      const validation = invalidRouter.validateConfig();
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors.some(e => e.includes('Invalid routing strategy'))).toBe(true);
      expect(validation.errors.some(e => e.includes('unknown server'))).toBe(true);
    });
  });

  describe('Configuration validation edge cases', () => {
    it('should handle empty routing rules', () => {
      const emptyConfig = {
        strategy: 'prefix' as const,
        rules: {},
        defaultServer: 'github'
      };
      router = new Router(emptyConfig, servers);

      const request = createRequest('test');
      const requestPath = '/unknown/method';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('github'); // Should use default
    });

    it('should handle missing default server gracefully', () => {
      const noDefaultConfig = {
        strategy: 'prefix' as const,
        rules: { github: 'github' },
        defaultServer: undefined
      };
      router = new Router(noDefaultConfig, servers);

      const request = createRequest('test');
      const requestPath = '/unknown/method';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No route found');
    });
  });

  describe('Mock configuration loading for isolated testing', () => {
    it('should work with minimal server configuration', () => {
      const minimalServers = {
        test: {
          name: 'test',
          url: 'http://test:8000'
        }
      };
      const minimalConfig = {
        strategy: 'prefix' as const,
        rules: { test: 'test' }
      };

      router = new Router(minimalConfig, minimalServers);

      const request = createRequest('test');
      const requestPath = '/test/method';

      const result = router.routeRequest(request, requestPath);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test');
      expect(result.serverUrl).toBe('http://test:8000');
    });

    it('should handle complex routing scenarios', () => {
      const complexConfig = {
        strategy: 'prefix' as const,
        rules: {
          'github-api': 'github',
          'fs-ops': 'filesystem',
          'drive-sync': 'gdrive',
          'gh': 'github', // Short alias
          'file': 'filesystem' // Alternative alias
        },
        defaultServer: 'filesystem'
      };

      router = new Router(complexConfig, servers);

      // Test various routing scenarios
      const testCases = [
        { path: '/github-api/repos', expected: 'github' },
        { path: '/fs-ops/read', expected: 'filesystem' },
        { path: '/drive-sync/upload', expected: 'gdrive' },
        { path: '/gh/issues', expected: 'github' },
        { path: '/file/write', expected: 'filesystem' },
        { path: '/unknown/action', expected: 'filesystem' } // Default
      ];

      testCases.forEach(({ path, expected }) => {
        const request = createRequest('test');
        const result = router.routeRequest(request, path);
        
        expect(result.success).toBe(true);
        expect(result.serverName).toBe(expected);
      });
    });
  });
});