export interface MCPRequest {
  method: string;
  params: Record<string, any>;
  id?: string;
  jsonrpc: string;
}

export interface MCPError {
  code: number;
  message: string;
  data?: Record<string, any>;
}

export interface MCPResponse {
  result?: Record<string, any>;
  error?: MCPError;
  id?: string;
  jsonrpc: string;
}

export interface MCPMethod {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
  parameters?: Record<string, any>; // Keep for backward compatibility
}

export interface MCPMethodsResponse {
  methods: MCPMethod[];
}

// Web UI Models
export interface ChatMessage {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  server: string;
  parameters: Record<string, any>;
  status: "pending" | "running" | "completed" | "failed";
  result?: Record<string, any>;
  error?: string;
}

export interface ServerStatus {
  name: string;
  url: string;
  status: "online" | "offline" | "error";
  available_tools: string[];
  last_check: Date;
}

/**
 * Create a new MCP request.
 */
export function createMCPRequest(
  method: string,
  params: Record<string, any> = {},
  id?: string
): MCPRequest {
  return {
    method,
    params,
    id,
    jsonrpc: "2.0",
  };
}

/**
 * Create a successful MCP response.
 */
export function createMCPResponse(
  result: Record<string, any>,
  id?: string
): MCPResponse {
  return {
    result,
    id,
    jsonrpc: "2.0",
  };
}

/**
 * Create an error MCP response.
 */
export function createMCPErrorResponse(
  code: number,
  message: string,
  id?: string,
  data?: Record<string, any>
): MCPResponse {
  return {
    error: {
      code,
      message,
      data,
    },
    id,
    jsonrpc: "2.0",
  };
}

/**
 * Create a new chat message.
 */
export function createChatMessage(
  content: string,
  role: "user" | "assistant",
  tool_calls?: ToolCall[]
): ChatMessage {
  return {
    id: generateId(),
    content,
    role,
    timestamp: new Date(),
    tool_calls,
  };
}

/**
 * Create a new tool call.
 */
export function createToolCall(
  name: string,
  server: string,
  parameters: Record<string, any>
): ToolCall {
  return {
    id: generateId(),
    name,
    server,
    parameters,
    status: "pending",
  };
}

/**
 * Create a server status object.
 */
export function createServerStatus(
  name: string,
  url: string,
  status: "online" | "offline" | "error",
  available_tools: string[] = []
): ServerStatus {
  return {
    name,
    url,
    status,
    available_tools,
    last_check: new Date(),
  };
}

/**
 * Generate a unique ID for messages and tool calls.
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}
