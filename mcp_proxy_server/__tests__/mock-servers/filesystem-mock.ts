import express from 'express';
import { MCPResponse, MCPRequest, createMCPResponse, createMCPErrorResponse } from '../../models';

export interface FilesystemMockOptions {
  port?: number;
  delay?: number;
  errorRate?: number;
}

export class FilesystemMockServer {
  private app: express.Application;
  private server: any;
  private options: FilesystemMockOptions;
  private mockFileSystem: Map<string, any>;

  constructor(options: FilesystemMockOptions = {}) {
    this.options = {
      port: 8002,
      delay: 0,
      errorRate: 0,
      ...options
    };
    this.app = express();
    this.mockFileSystem = new Map();
    this.initializeMockFileSystem();
    this.setupRoutes();
  }

  private initializeMockFileSystem(): void {
    // Create mock file system structure
    this.mockFileSystem.set('/home/user/documents', {
      type: 'directory',
      children: ['readme.md', 'project.json', 'src']
    });

    this.mockFileSystem.set('/home/user/documents/readme.md', {
      type: 'file',
      content: '# Project Documentation\n\nThis is a sample project.',
      size: 45,
      modified: '2023-12-01T10:00:00Z'
    });

    this.mockFileSystem.set('/home/user/documents/project.json', {
      type: 'file',
      content: JSON.stringify({
        name: 'mock-project',
        version: '1.0.0',
        description: 'A mock project for testing'
      }, null, 2),
      size: 89,
      modified: '2023-12-01T09:30:00Z'
    });

    this.mockFileSystem.set('/home/user/documents/src', {
      type: 'directory',
      children: ['main.ts', 'utils.ts']
    });

    this.mockFileSystem.set('/home/user/documents/src/main.ts', {
      type: 'file',
      content: 'console.log("Hello, World!");',
      size: 28,
      modified: '2023-12-01T11:15:00Z'
    });

    this.mockFileSystem.set('/home/user/documents/src/utils.ts', {
      type: 'file',
      content: 'export function helper() { return "helper"; }',
      size: 44,
      modified: '2023-12-01T11:20:00Z'
    });
  }

  private setupRoutes(): void {
    this.app.use(express.json());

    // Add artificial delay if configured
    this.app.use((req, res, next) => {
      if (this.options.delay && this.options.delay > 0) {
        setTimeout(next, this.options.delay);
      } else {
        next();
      }
    });

    // Simulate random errors if configured
    this.app.use((req, res, next) => {
      if (this.options.errorRate && Math.random() < this.options.errorRate) {
        return res.status(500).json({
          error: {
            code: -32603,
            message: 'Simulated filesystem error'
          },
          jsonrpc: '2.0',
          id: req.body?.id
        });
      }
      next();
    });

    // Main MCP endpoint
    this.app.post('/', (req, res) => {
      const request: MCPRequest = req.body;
      const response = this.handleMCPRequest(request);
      res.json(response);
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', server: 'filesystem-mock' });
    });
  }

  private handleMCPRequest(request: MCPRequest): MCPResponse {
    switch (request.method) {
      case 'tools/list':
      case 'get_methods':
        return this.handleGetMethods(request);
      
      case 'tools/call':
      case 'invoke_method':
        return this.handleInvokeMethod(request);
      
      default:
        return createMCPErrorResponse(
          -32601,
          `Method '${request.method}' not found`,
          request.id
        );
    }
  }

  private handleGetMethods(request: MCPRequest): MCPResponse {
    const tools = [
      {
        name: 'read_file',
        description: 'Read the contents of a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to read' }
          },
          required: ['path']
        }
      },
      {
        name: 'write_file',
        description: 'Write content to a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to write' },
            content: { type: 'string', description: 'Content to write' }
          },
          required: ['path', 'content']
        }
      },
      {
        name: 'list_directory',
        description: 'List contents of a directory',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path to list' }
          },
          required: ['path']
        }
      },
      {
        name: 'create_directory',
        description: 'Create a new directory',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path to create' }
          },
          required: ['path']
        }
      },
      {
        name: 'delete_file',
        description: 'Delete a file or directory',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to delete' }
          },
          required: ['path']
        }
      },
      {
        name: 'get_file_info',
        description: 'Get information about a file or directory',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to get info for' }
          },
          required: ['path']
        }
      }
    ];

    return createMCPResponse({ tools }, request.id);
  }

  private handleInvokeMethod(request: MCPRequest): MCPResponse {
    const { name, arguments: args } = request.params || {};

    switch (name) {
      case 'read_file':
        return this.mockReadFile(args, request.id);
      
      case 'write_file':
        return this.mockWriteFile(args, request.id);
      
      case 'list_directory':
        return this.mockListDirectory(args, request.id);
      
      case 'create_directory':
        return this.mockCreateDirectory(args, request.id);
      
      case 'delete_file':
        return this.mockDeleteFile(args, request.id);
      
      case 'get_file_info':
        return this.mockGetFileInfo(args, request.id);
      
      default:
        return createMCPErrorResponse(
          -32601,
          `Tool '${name}' not found`,
          request.id
        );
    }
  }

  private mockReadFile(args: any, requestId?: string): MCPResponse {
    if (!args?.path) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameter: path',
        requestId
      );
    }

    const fileInfo = this.mockFileSystem.get(args.path);
    if (!fileInfo) {
      return createMCPErrorResponse(
        -32603,
        `File not found: ${args.path}`,
        requestId
      );
    }

    if (fileInfo.type !== 'file') {
      return createMCPErrorResponse(
        -32603,
        `Path is not a file: ${args.path}`,
        requestId
      );
    }

    return createMCPResponse({
      content: fileInfo.content,
      path: args.path,
      size: fileInfo.size,
      modified: fileInfo.modified
    }, requestId);
  }

  private mockWriteFile(args: any, requestId?: string): MCPResponse {
    if (!args?.path || args?.content === undefined) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameters: path, content',
        requestId
      );
    }

    // Update or create file in mock filesystem
    this.mockFileSystem.set(args.path, {
      type: 'file',
      content: args.content,
      size: args.content.length,
      modified: new Date().toISOString()
    });

    return createMCPResponse({
      success: true,
      path: args.path,
      bytesWritten: args.content.length
    }, requestId);
  }

  private mockListDirectory(args: any, requestId?: string): MCPResponse {
    if (!args?.path) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameter: path',
        requestId
      );
    }

    const dirInfo = this.mockFileSystem.get(args.path);
    if (!dirInfo) {
      return createMCPErrorResponse(
        -32603,
        `Directory not found: ${args.path}`,
        requestId
      );
    }

    if (dirInfo.type !== 'directory') {
      return createMCPErrorResponse(
        -32603,
        `Path is not a directory: ${args.path}`,
        requestId
      );
    }

    const entries = dirInfo.children.map((child: string) => {
      const childPath = `${args.path}/${child}`;
      const childInfo = this.mockFileSystem.get(childPath);
      return {
        name: child,
        path: childPath,
        type: childInfo?.type || 'unknown',
        size: childInfo?.size || 0,
        modified: childInfo?.modified || new Date().toISOString()
      };
    });

    return createMCPResponse({
      path: args.path,
      entries
    }, requestId);
  }

  private mockCreateDirectory(args: any, requestId?: string): MCPResponse {
    if (!args?.path) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameter: path',
        requestId
      );
    }

    if (this.mockFileSystem.has(args.path)) {
      return createMCPErrorResponse(
        -32603,
        `Path already exists: ${args.path}`,
        requestId
      );
    }

    this.mockFileSystem.set(args.path, {
      type: 'directory',
      children: [],
      created: new Date().toISOString()
    });

    return createMCPResponse({
      success: true,
      path: args.path
    }, requestId);
  }

  private mockDeleteFile(args: any, requestId?: string): MCPResponse {
    if (!args?.path) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameter: path',
        requestId
      );
    }

    if (!this.mockFileSystem.has(args.path)) {
      return createMCPErrorResponse(
        -32603,
        `Path not found: ${args.path}`,
        requestId
      );
    }

    this.mockFileSystem.delete(args.path);

    return createMCPResponse({
      success: true,
      path: args.path
    }, requestId);
  }

  private mockGetFileInfo(args: any, requestId?: string): MCPResponse {
    if (!args?.path) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameter: path',
        requestId
      );
    }

    const fileInfo = this.mockFileSystem.get(args.path);
    if (!fileInfo) {
      return createMCPErrorResponse(
        -32603,
        `Path not found: ${args.path}`,
        requestId
      );
    }

    const info: any = {
      path: args.path,
      type: fileInfo.type,
      exists: true
    };

    if (fileInfo.type === 'file') {
      info.size = fileInfo.size;
      info.modified = fileInfo.modified;
    } else if (fileInfo.type === 'directory') {
      info.childCount = fileInfo.children?.length || 0;
      info.created = fileInfo.created;
    }

    return createMCPResponse(info, requestId);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.options.port, () => {
          console.log(`Filesystem Mock Server running on port ${this.options.port}`);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Filesystem Mock Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getUrl(): string {
    return `http://localhost:${this.options.port}`;
  }

  // Test utilities
  setErrorRate(rate: number): void {
    this.options.errorRate = Math.max(0, Math.min(1, rate));
  }

  setDelay(ms: number): void {
    this.options.delay = Math.max(0, ms);
  }

  // Add file to mock filesystem for testing
  addMockFile(path: string, content: string): void {
    this.mockFileSystem.set(path, {
      type: 'file',
      content,
      size: content.length,
      modified: new Date().toISOString()
    });
  }

  // Add directory to mock filesystem for testing
  addMockDirectory(path: string, children: string[] = []): void {
    this.mockFileSystem.set(path, {
      type: 'directory',
      children,
      created: new Date().toISOString()
    });
  }
}