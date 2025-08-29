import axios, { AxiosError } from 'axios';
import { RequestForwarder } from '../request-forwarder';
import { MCPRequest, MCPResponse, createMCPRequest, createMCPResponse, createMCPErrorResponse } from '../models';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('RequestForwarder', () => {
  let forwarder: RequestForwarder;
  let mockAxiosInstance: jest.Mocked<any>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };
    
    // Mock axios.create to return our mock instance
    mockedAxios.create.mockReturnValue(mockAxiosInstance);
    
    // Create forwarder instance
    forwarder = new RequestForwarder({
      timeout: 5000,
      maxRetries: 2,
      retryDelay: 100
    });
  });

  describe('Constructor and initialization', () => {
    it('should initialize with default options', () => {
      const defaultForwarder = new RequestForwarder();
      expect(mockedAxios.create).toHaveBeenCalledWith({
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
    });

    it('should initialize with custom options', () => {
      const customForwarder = new RequestForwarder({
        timeout: 10000,
        maxRetries: 5,
        retryDelay: 2000
      });
      
      expect(mockedAxios.create).toHaveBeenCalledWith({
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
    });
  });

  describe('Successful request forwarding', () => {
    it('should forward request successfully', async () => {
      const request = createMCPRequest('tools/list', {});
      const expectedResponse = createMCPResponse({ tools: [] });
      const serverUrl = 'http://localhost:8001';

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: expectedResponse
      });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        serverUrl,
        request,
        { timeout: 30000 }
      );
      expect(result).toEqual(expectedResponse);
    });

    it('should forward request with custom timeout', async () => {
      const request = createMCPRequest('tools/invoke', { name: 'test' });
      const expectedResponse = createMCPResponse({ result: 'success' });
      const serverUrl = 'http://localhost:8002';

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: expectedResponse
      });

      const result = await forwarder.forwardRequest(serverUrl, request, {
        timeout: 15000
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        serverUrl,
        request,
        { timeout: 15000 }
      );
      expect(result).toEqual(expectedResponse);
    });

    it('should handle different MCP response formats', async () => {
      const request = createMCPRequest('get_methods', {});
      const expectedResponse = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          methods: [
            { name: 'test_method', description: 'Test method' }
          ]
        }
      };
      const serverUrl = 'http://localhost:8003';

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: expectedResponse
      });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(result).toEqual(expectedResponse);
    });
  });

  describe('Error handling and retries', () => {
    it('should retry on network errors', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';
      const networkError = new Error('Network Error');
      (networkError as any).isAxiosError = false;

      // First two calls fail, third succeeds
      mockAxiosInstance.post
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({
          status: 200,
          data: createMCPResponse({ success: true })
        });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
      expect(result.result).toEqual({ success: true });
    });

    it('should not retry on 4xx client errors', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';
      const clientError = {
        isAxiosError: true,
        response: {
          status: 400,
          data: { error: 'Bad Request' }
        },
        message: 'Request failed with status code 400'
      } as AxiosError;

      mockAxiosInstance.post.mockRejectedValueOnce(clientError);

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Failed to forward request');
    });

    it('should retry on 5xx server errors', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';
      const serverError = {
        isAxiosError: true,
        response: {
          status: 500,
          data: { error: 'Internal Server Error' }
        },
        message: 'Request failed with status code 500'
      } as AxiosError;

      mockAxiosInstance.post
        .mockRejectedValueOnce(serverError)
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({
          status: 200,
          data: createMCPResponse({ success: true })
        });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
      expect(result.result).toEqual({ success: true });
    });

    it('should return error response after all retries fail', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';
      const networkError = new Error('Connection timeout');

      mockAxiosInstance.post.mockRejectedValue(networkError);

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3); // maxRetries = 2 (means 3 attempts)
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe(-32603);
      expect(result.error?.message).toContain('Failed to forward request');
      expect(result.error?.data?.serverUrl).toBe(serverUrl);
      expect(result.error?.data?.attempts).toBe(3);
    });

    it('should handle timeout scenarios', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';
      const timeoutError = {
        isAxiosError: true,
        code: 'ECONNABORTED',
        message: 'timeout of 5000ms exceeded'
      } as AxiosError;

      mockAxiosInstance.post.mockRejectedValue(timeoutError);

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('timeout');
    });

    it('should validate MCP response format', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';
      const invalidResponse = {
        status: 200,
        data: { invalid: 'response' } // Missing jsonrpc field
      };

      mockAxiosInstance.post.mockResolvedValueOnce(invalidResponse);

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Failed to forward request');
    });
  });

  describe('Server health checking', () => {
    it('should check server health successfully', async () => {
      const serverUrl = 'http://localhost:8001';
      
      mockAxiosInstance.get.mockResolvedValueOnce({
        status: 200,
        data: { status: 'healthy' }
      });

      const isHealthy = await forwarder.checkServerHealth(serverUrl);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        'http://localhost:8001/health',
        { timeout: 5000 }
      );
      expect(isHealthy).toBe(true);
    });

    it('should check server health with custom path', async () => {
      const serverUrl = 'http://localhost:8001';
      const customPath = '/status';
      
      mockAxiosInstance.get.mockResolvedValueOnce({
        status: 200,
        data: { status: 'ok' }
      });

      const isHealthy = await forwarder.checkServerHealth(serverUrl, customPath);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        'http://localhost:8001/status',
        { timeout: 5000 }
      );
      expect(isHealthy).toBe(true);
    });

    it('should return false for unhealthy server', async () => {
      const serverUrl = 'http://localhost:8001';
      
      mockAxiosInstance.get.mockResolvedValueOnce({
        status: 503,
        data: { status: 'unhealthy' }
      });

      const isHealthy = await forwarder.checkServerHealth(serverUrl);

      expect(isHealthy).toBe(false);
    });

    it('should return false when health check fails', async () => {
      const serverUrl = 'http://localhost:8001';
      const networkError = new Error('Connection refused');
      
      mockAxiosInstance.get.mockRejectedValueOnce(networkError);

      const isHealthy = await forwarder.checkServerHealth(serverUrl);

      expect(isHealthy).toBe(false);
    });

    it('should handle different HTTP status codes', async () => {
      const serverUrl = 'http://localhost:8001';
      
      // Test various status codes
      const testCases = [
        { status: 200, expected: true },
        { status: 204, expected: true },
        { status: 299, expected: true },
        { status: 300, expected: false },
        { status: 404, expected: false },
        { status: 500, expected: false }
      ];

      for (const { status, expected } of testCases) {
        mockAxiosInstance.get.mockResolvedValueOnce({
          status,
          data: {}
        });

        const isHealthy = await forwarder.checkServerHealth(serverUrl);
        expect(isHealthy).toBe(expected);
      }
    });
  });

  describe('Request payload integrity', () => {
    it('should preserve request payload during forwarding', async () => {
      const originalRequest = createMCPRequest('tools/invoke', {
        name: 'test_tool',
        arguments: {
          param1: 'value1',
          param2: 42,
          param3: { nested: 'object' }
        }
      });
      const serverUrl = 'http://localhost:8001';
      const expectedResponse = createMCPResponse({ result: 'success' });

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: expectedResponse
      });

      await forwarder.forwardRequest(serverUrl, originalRequest);

      // Verify the exact request was forwarded
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        serverUrl,
        originalRequest,
        { timeout: 30000 }
      );
    });

    it('should handle requests with no parameters', async () => {
      const request = createMCPRequest('get_methods', {});
      const serverUrl = 'http://localhost:8001';
      const expectedResponse = createMCPResponse({ methods: [] });

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: expectedResponse
      });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(result).toEqual(expectedResponse);
    });

    it('should handle requests with complex nested parameters', async () => {
      const complexParams = {
        filters: {
          type: 'file',
          extensions: ['.ts', '.js'],
          size: { min: 0, max: 1000000 }
        },
        options: {
          recursive: true,
          includeHidden: false,
          sortBy: 'name'
        }
      };
      
      const request = createMCPRequest('filesystem/search', complexParams);
      const serverUrl = 'http://localhost:8002';
      const expectedResponse = createMCPResponse({ files: [] });

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: expectedResponse
      });

      await forwarder.forwardRequest(serverUrl, request);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        serverUrl,
        expect.objectContaining({
          method: 'filesystem/search',
          params: complexParams
        }),
        { timeout: 30000 }
      );
    });
  });

  describe('Response validation', () => {
    it('should accept valid MCP success response', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';
      const validResponse = {
        jsonrpc: '2.0',
        id: request.id,
        result: { tools: [] }
      };

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: validResponse
      });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(result).toEqual(validResponse);
    });

    it('should accept valid MCP error response', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';
      const validErrorResponse = {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32601,
          message: 'Method not found'
        }
      };

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: validErrorResponse
      });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(result).toEqual(validErrorResponse);
    });

    it('should reject response with both result and error', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';
      const invalidResponse = {
        jsonrpc: '2.0',
        id: request.id,
        result: { tools: [] },
        error: { code: -32603, message: 'Internal error' }
      };

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: invalidResponse
      });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Failed to forward request');
    });

    it('should reject response with neither result nor error', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';
      const invalidResponse = {
        jsonrpc: '2.0',
        id: request.id
      };

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: invalidResponse
      });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Failed to forward request');
    });

    it('should reject response with invalid jsonrpc version', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';
      const invalidResponse = {
        jsonrpc: '1.0',
        id: request.id,
        result: { tools: [] }
      };

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: invalidResponse
      });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Failed to forward request');
    });
  });

  describe('Statistics and monitoring', () => {
    it('should provide basic statistics', () => {
      const stats = forwarder.getStats();
      
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('successfulRequests');
      expect(stats).toHaveProperty('failedRequests');
      expect(stats).toHaveProperty('averageResponseTime');
    });
  });

  describe('Edge cases and error scenarios', () => {
    it('should handle null or undefined responses', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: null
      });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Failed to forward request');
    });

    it('should handle non-object responses', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: 'invalid response'
      });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Failed to forward request');
    });

    it('should handle malformed error objects in response', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';
      const invalidErrorResponse = {
        jsonrpc: '2.0',
        id: request.id,
        error: 'not an object'
      };

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: invalidErrorResponse
      });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Failed to forward request');
    });

    it('should handle error objects missing required fields', async () => {
      const request = createMCPRequest('tools/list', {});
      const serverUrl = 'http://localhost:8001';
      const invalidErrorResponse = {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603 } // Missing message
      };

      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 200,
        data: invalidErrorResponse
      });

      const result = await forwarder.forwardRequest(serverUrl, request);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Failed to forward request');
    });
  });
});