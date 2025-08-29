import { ErrorHandler, DownstreamError, ErrorContext } from "../error-handler";
import { RoutingError } from "../router";
import { MCPResponse } from "../models";

describe("ErrorHandler", () => {
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    errorHandler = new ErrorHandler();
  });

  describe("Routing error scenarios", () => {
    it("should handle unknown route errors", () => {
      const routingError = new RoutingError(
        "No route found",
        "No matching routing rule found and no default server configured",
        "/unknown/path",
        { "Content-Type": "application/json" }
      );

      const context: ErrorContext = {
        requestId: "test-123",
        method: "tools/list",
        requestPath: "/unknown/path",
      };

      const response = errorHandler.handleRoutingError(routingError, context);

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32601); // Method not found
      expect(response.error!.message).toContain("No routing rule found");
      expect(response.error!.data).toMatchObject({
        type: "routing_error",
        details:
          "No matching routing rule found and no default server configured",
        requestPath: "/unknown/path",
        method: "tools/list",
      });
      expect(response.id).toBe("test-123");
    });

    it("should handle invalid routing strategy errors", () => {
      const routingError = new RoutingError(
        "Invalid routing strategy",
        "Unknown strategy: invalid",
        undefined,
        undefined
      );

      const response = errorHandler.handleRoutingError(routingError);

      expect(response.error!.code).toBe(-32602); // Invalid params
      expect(response.error!.message).toContain(
        "Invalid routing configuration"
      );
      expect(response.error!.data?.type).toBe("routing_error");
    });

    it("should handle server not found errors", () => {
      const routingError = new RoutingError(
        "Server not found",
        "Server 'nonexistent' is not configured",
        "/test/path",
        undefined
      );

      const response = errorHandler.handleRoutingError(routingError);

      expect(response.error!.code).toBe(-32601); // Method not found
      expect(response.error!.message).toContain(
        "target server is not configured"
      );
      expect(response.error!.data?.requestPath).toBe("/test/path");
    });

    it("should include available headers in routing error data", () => {
      const headers = {
        "Content-Type": "application/json",
        "User-Agent": "test-client",
        Authorization: "Bearer token",
      };

      const routingError = new RoutingError(
        "No route found",
        "No header routing found",
        undefined,
        headers
      );

      const response = errorHandler.handleRoutingError(routingError);

      expect(response.error!.data?.availableHeaders).toEqual([
        "Content-Type",
        "User-Agent",
        "Authorization",
      ]);
    });
  });

  describe("Downstream server error scenarios", () => {
    it("should handle server unavailability errors", () => {
      const downstreamError = new DownstreamError(
        "Connection refused",
        "github",
        "http://localhost:8001"
      );

      const context: ErrorContext = {
        requestId: "test-456",
        method: "tools/invoke",
        serverName: "github",
      };

      const response = errorHandler.handleDownstreamError(
        downstreamError,
        context
      );

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32603); // Internal error
      expect(response.error!.message).toContain(
        "Failed to communicate with server 'github'"
      );
      expect(response.error!.data).toMatchObject({
        type: "downstream_error",
        serverName: "github",
        serverUrl: "http://localhost:8001",
        method: "tools/invoke",
      });
      expect(response.id).toBe("test-456");
    });

    it("should handle 404 errors from downstream servers", () => {
      const downstreamError = new DownstreamError(
        "Not Found",
        "filesystem",
        "http://localhost:8002",
        404,
        { error: "File not found" }
      );

      const response = errorHandler.handleDownstreamError(downstreamError);

      expect(response.error!.code).toBe(-32602); // Invalid params (client error)
      expect(response.error!.message).toContain(
        "requested resource was not found on server 'filesystem'"
      );
      expect(response.error!.data?.statusCode).toBe(404);
      expect(response.error!.data?.serverResponse).toEqual({
        error: "File not found",
      });
    });

    it("should handle 401/403 authentication errors", () => {
      const downstreamError = new DownstreamError(
        "Unauthorized",
        "github",
        "http://localhost:8001",
        401,
        { message: "Invalid token" }
      );

      const response = errorHandler.handleDownstreamError(downstreamError);

      expect(response.error!.code).toBe(-32602); // Invalid params
      expect(response.error!.message).toContain(
        "Authentication or authorization failed for server 'github'"
      );
    });

    it("should handle 500 server errors", () => {
      const downstreamError = new DownstreamError(
        "Internal Server Error",
        "gdrive",
        "http://localhost:8003",
        500,
        { error: "Database connection failed" }
      );

      const response = errorHandler.handleDownstreamError(downstreamError);

      expect(response.error!.code).toBe(-32603); // Internal error
      expect(response.error!.message).toContain(
        "Server 'gdrive' is experiencing internal issues"
      );
    });
  });

  describe("Protocol error handling", () => {
    it("should handle general protocol errors", () => {
      const protocolError = new Error("Invalid JSON format");
      const context: ErrorContext = {
        requestId: "test-789",
        method: "get_methods",
      };

      const response = errorHandler.handleProtocolError(protocolError, context);

      expect(response.error!.code).toBe(-32603); // Internal error
      expect(response.error!.message).toContain(
        "Invalid request or response format"
      );
      expect(response.error!.data?.type).toBe("protocol_error");
      expect(response.error!.data?.originalError).toBe("Error");
      expect(response.id).toBe("test-789");
    });

    it("should handle timeout errors specifically", () => {
      const timeoutError = new Error("Request timeout after 30000ms");

      const response = errorHandler.handleProtocolError(timeoutError);

      expect(response.error!.message).toContain(
        "Request timed out while processing"
      );
    });

    it("should handle network connection errors", () => {
      const networkError = new Error("Network connection failed");

      const response = errorHandler.handleProtocolError(networkError);

      expect(response.error!.message).toContain(
        "Network connection error occurred"
      );
    });

    it("should use custom error codes when provided", () => {
      const customError = new Error("Custom error");
      const customCode = -32000;

      const response = errorHandler.handleProtocolError(
        customError,
        undefined,
        customCode
      );

      expect(response.error!.code).toBe(customCode);
    });
  });

  describe("Validation error handling", () => {
    it("should handle request validation errors", () => {
      const validationErrors = [
        "Missing required field: method",
        "Invalid jsonrpc version",
        "Parameters must be an object",
      ];

      const context: ErrorContext = {
        requestId: "test-validation",
        method: undefined,
      };

      const response = errorHandler.handleValidationError(
        validationErrors,
        context
      );

      expect(response.error!.code).toBe(-32600); // Invalid Request
      expect(response.error!.message).toContain("Invalid request format");
      expect(response.error!.message).toContain(
        "Missing required field: method"
      );
      expect(response.error!.data?.validationErrors).toEqual(validationErrors);
      expect(response.id).toBe("test-validation");
    });
  });

  describe("Timeout error handling", () => {
    it("should handle timeout errors with context", () => {
      const timeoutMs = 5000;
      const context: ErrorContext = {
        requestId: "test-timeout",
        method: "tools/invoke",
        serverName: "slow-server",
      };

      const response = errorHandler.handleTimeoutError(timeoutMs, context);

      expect(response.error!.code).toBe(-32603); // Internal error
      expect(response.error!.message).toBe("Request timed out after 5000ms");
      expect(response.error!.data).toMatchObject({
        type: "timeout_error",
        timeoutMs: 5000,
        serverName: "slow-server",
        method: "tools/invoke",
      });
    });
  });

  describe("Rate limiting error handling", () => {
    it("should handle rate limit exceeded errors", () => {
      const limit = 100;
      const windowMs = 60000; // 1 minute

      const response = errorHandler.handleRateLimitError(limit, windowMs);

      expect(response.error!.code).toBe(-32000); // Custom server error
      expect(response.error!.message).toContain(
        "Rate limit exceeded: 100 requests per 60000ms"
      );
      expect(response.error!.data).toMatchObject({
        type: "rate_limit_error",
        limit: 100,
        windowMs: 60000,
        retryAfter: 60, // seconds
      });
    });
  });

  describe("Error context creation", () => {
    it("should create error context with all parameters", () => {
      const context = errorHandler.createErrorContext(
        "req-123",
        "tools/list",
        "github",
        "http://localhost:8001",
        "/github/tools/list",
        { "Content-Type": "application/json" }
      );

      expect(context).toMatchObject({
        requestId: "req-123",
        method: "tools/list",
        serverName: "github",
        serverUrl: "http://localhost:8001",
        requestPath: "/github/tools/list",
        headers: { "Content-Type": "application/json" },
      });
      expect(context.timestamp).toBeInstanceOf(Date);
    });

    it("should create error context with minimal parameters", () => {
      const context = errorHandler.createErrorContext("req-456");

      expect(context.requestId).toBe("req-456");
      expect(context.timestamp).toBeInstanceOf(Date);
      expect(context.method).toBeUndefined();
    });
  });

  describe("Error logging", () => {
    it("should log errors with different severity levels", () => {
      const testError = new Error("Test error");
      const context: ErrorContext = { requestId: "test-log" };

      // Test that logging doesn't throw errors
      expect(() => {
        errorHandler.logError(testError, "debug", context);
        errorHandler.logError(testError, "info", context);
        errorHandler.logError(testError, "warn", context);
        errorHandler.logError(testError, "error", context);
      }).not.toThrow();
    });

    it("should log errors with additional data", () => {
      const testError = new Error("Test error with data");
      const additionalData = { customField: "customValue" };

      expect(() => {
        errorHandler.logError(testError, "error", undefined, additionalData);
      }).not.toThrow();
    });
  });

  describe("Retry logic helpers", () => {
    it("should identify retryable errors correctly", () => {
      // Retryable errors
      expect(
        errorHandler.isRetryableError(new Error("Connection timeout"))
      ).toBe(true);
      expect(errorHandler.isRetryableError(new Error("Network error"))).toBe(
        true
      );
      expect(errorHandler.isRetryableError(new Error("ECONNRESET"))).toBe(true);

      const serverError = new DownstreamError(
        "Server error",
        "test",
        "url",
        500
      );
      expect(errorHandler.isRetryableError(serverError)).toBe(true);

      // Non-retryable errors
      const clientError = new DownstreamError(
        "Bad request",
        "test",
        "url",
        400
      );
      expect(errorHandler.isRetryableError(clientError)).toBe(false);

      expect(errorHandler.isRetryableError(new Error("Invalid JSON"))).toBe(
        false
      );
    });

    it("should calculate retry delays with exponential backoff", () => {
      expect(errorHandler.getRetryDelay(1, 1000)).toBe(1000);
      expect(errorHandler.getRetryDelay(2, 1000)).toBe(2000);
      expect(errorHandler.getRetryDelay(3, 1000)).toBe(4000);
      expect(errorHandler.getRetryDelay(4, 1000)).toBe(8000);
      expect(errorHandler.getRetryDelay(10, 1000)).toBe(30000); // Max cap
    });
  });

  describe("Data sanitization", () => {
    it("should sanitize sensitive information from error data", () => {
      const sensitiveData = {
        username: "user123",
        password: "secret123",
        api_key: "key123",
        token: "token123",
        normalField: "normalValue",
        nested: {
          authorization: "Bearer secret",
          publicData: "public",
        },
      };

      const sanitized = errorHandler.sanitizeErrorData(sensitiveData);

      expect(sanitized.username).toBe("user123");
      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.api_key).toBe("[REDACTED]");
      expect(sanitized.token).toBe("[REDACTED]");
      expect(sanitized.normalField).toBe("normalValue");
      expect(sanitized.nested.authorization).toBe("[REDACTED]");
      expect(sanitized.nested.publicData).toBe("public");
    });

    it("should handle non-object data safely", () => {
      expect(errorHandler.sanitizeErrorData("string")).toBe("string");
      expect(errorHandler.sanitizeErrorData(123)).toBe(123);
      expect(errorHandler.sanitizeErrorData(null)).toBe(null);
      expect(errorHandler.sanitizeErrorData(undefined)).toBe(undefined);
    });
  });

  describe("MCP protocol compliance in error responses", () => {
    it("should return MCP-compliant error response structure", () => {
      const routingError = new RoutingError("Test error", "Test details");
      const response = errorHandler.handleRoutingError(routingError);

      expect(response.jsonrpc).toBe("2.0");
      expect(response.result).toBeUndefined();
      expect(response.error).toBeDefined();
      expect(typeof response.error!.code).toBe("number");
      expect(typeof response.error!.message).toBe("string");
    });

    it("should include proper error codes according to JSON-RPC 2.0 spec", () => {
      // Test various error scenarios and their codes
      const testCases = [
        {
          error: new RoutingError(
            "Invalid routing strategy",
            "Unknown strategy"
          ),
          expectedCode: -32602, // Invalid params
        },
        {
          error: new RoutingError("No route found", "No matching rule"),
          expectedCode: -32601, // Method not found
        },
      ];

      testCases.forEach(({ error, expectedCode }) => {
        const response = errorHandler.handleRoutingError(error);
        expect(response.error!.code).toBe(expectedCode);
      });
    });

    it("should preserve request ID in error responses", () => {
      const context: ErrorContext = { requestId: "preserve-test-123" };
      const error = new RoutingError("Test", "Test");

      const response = errorHandler.handleRoutingError(error, context);

      expect(response.id).toBe("preserve-test-123");
    });

    it("should include timestamp in all error responses", () => {
      const error = new RoutingError("Test", "Test");
      const response = errorHandler.handleRoutingError(error);

      expect(response.error!.data?.timestamp).toBeDefined();
      expect(new Date(response.error!.data!.timestamp)).toBeInstanceOf(Date);
    });
  });
});
