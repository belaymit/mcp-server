import express from 'express';
import { MCPResponse, MCPRequest, createMCPResponse, createMCPErrorResponse } from '../../models';

export interface GDriveMockOptions {
  port?: number;
  delay?: number;
  errorRate?: number;
}

export class GDriveMockServer {
  private app: express.Application;
  private server: any;
  private options: GDriveMockOptions;
  private mockFiles: Map<string, any>;

  constructor(options: GDriveMockOptions = {}) {
    this.options = {
      port: 8003,
      delay: 0,
      errorRate: 0,
      ...options
    };
    this.app = express();
    this.mockFiles = new Map();
    this.initializeMockFiles();
    this.setupRoutes();
  }

  private initializeMockFiles(): void {
    // Create mock Google Drive files
    this.mockFiles.set('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', {
      id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      name: 'Project Documentation',
      mimeType: 'application/vnd.google-apps.document',
      kind: 'drive#file',
      parents: ['root'],
      createdTime: '2023-11-01T10:00:00Z',
      modifiedTime: '2023-12-01T15:30:00Z',
      size: '2048',
      webViewLink: 'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
      content: '# Project Documentation\n\nThis document contains project specifications and requirements.'
    });

    this.mockFiles.set('1Abc123DefGhi456JklMno789PqrStu012VwxYz345', {
      id: '1Abc123DefGhi456JklMno789PqrStu012VwxYz345',
      name: 'Meeting Notes.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      kind: 'drive#file',
      parents: ['1FolderIdExample'],
      createdTime: '2023-11-15T09:00:00Z',
      modifiedTime: '2023-11-15T16:45:00Z',
      size: '15360',
      webViewLink: 'https://drive.google.com/file/d/1Abc123DefGhi456JklMno789PqrStu012VwxYz345/view',
      downloadUrl: 'https://drive.google.com/uc?id=1Abc123DefGhi456JklMno789PqrStu012VwxYz345'
    });

    this.mockFiles.set('1SpreadsheetExample789', {
      id: '1SpreadsheetExample789',
      name: 'Budget Tracker',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      kind: 'drive#file',
      parents: ['root'],
      createdTime: '2023-10-01T08:00:00Z',
      modifiedTime: '2023-12-01T12:00:00Z',
      size: '4096',
      webViewLink: 'https://docs.google.com/spreadsheets/d/1SpreadsheetExample789/edit',
      content: 'Month,Income,Expenses\nJanuary,5000,3500\nFebruary,5200,3800'
    });

    this.mockFiles.set('1FolderIdExample', {
      id: '1FolderIdExample',
      name: 'Project Files',
      mimeType: 'application/vnd.google-apps.folder',
      kind: 'drive#file',
      parents: ['root'],
      createdTime: '2023-10-15T10:00:00Z',
      modifiedTime: '2023-11-20T14:30:00Z'
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
            message: 'Simulated Google Drive error'
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
      res.json({ status: 'healthy', server: 'gdrive-mock' });
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
        name: 'list_files',
        description: 'List files in Google Drive',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (optional)' },
            pageSize: { type: 'number', description: 'Number of files to return', default: 10 },
            folderId: { type: 'string', description: 'Folder ID to search in (optional)' }
          }
        }
      },
      {
        name: 'get_file',
        description: 'Get information about a specific file',
        inputSchema: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'Google Drive file ID' }
          },
          required: ['fileId']
        }
      },
      {
        name: 'download_file',
        description: 'Download file content from Google Drive',
        inputSchema: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'Google Drive file ID' },
            mimeType: { type: 'string', description: 'Export MIME type for Google Docs (optional)' }
          },
          required: ['fileId']
        }
      },
      {
        name: 'upload_file',
        description: 'Upload a file to Google Drive',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'File name' },
            content: { type: 'string', description: 'File content' },
            mimeType: { type: 'string', description: 'MIME type' },
            parentId: { type: 'string', description: 'Parent folder ID (optional)' }
          },
          required: ['name', 'content']
        }
      },
      {
        name: 'create_folder',
        description: 'Create a new folder in Google Drive',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Folder name' },
            parentId: { type: 'string', description: 'Parent folder ID (optional)' }
          },
          required: ['name']
        }
      },
      {
        name: 'share_file',
        description: 'Share a file with specific permissions',
        inputSchema: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'Google Drive file ID' },
            email: { type: 'string', description: 'Email address to share with' },
            role: { type: 'string', enum: ['reader', 'writer', 'commenter'], default: 'reader' }
          },
          required: ['fileId', 'email']
        }
      }
    ];

    return createMCPResponse({ tools }, request.id);
  }

  private handleInvokeMethod(request: MCPRequest): MCPResponse {
    const { name, arguments: args } = request.params || {};

    switch (name) {
      case 'list_files':
        return this.mockListFiles(args, request.id);
      
      case 'get_file':
        return this.mockGetFile(args, request.id);
      
      case 'download_file':
        return this.mockDownloadFile(args, request.id);
      
      case 'upload_file':
        return this.mockUploadFile(args, request.id);
      
      case 'create_folder':
        return this.mockCreateFolder(args, request.id);
      
      case 'share_file':
        return this.mockShareFile(args, request.id);
      
      default:
        return createMCPErrorResponse(
          -32601,
          `Tool '${name}' not found`,
          request.id
        );
    }
  }

  private mockListFiles(args: any, requestId?: string): MCPResponse {
    const pageSize = args?.pageSize || 10;
    const query = args?.query;
    const folderId = args?.folderId;

    let files = Array.from(this.mockFiles.values());

    // Filter by folder if specified
    if (folderId) {
      files = files.filter(file => file.parents?.includes(folderId));
    }

    // Filter by query if specified
    if (query) {
      files = files.filter(file => 
        file.name.toLowerCase().includes(query.toLowerCase()) ||
        file.mimeType.includes(query.toLowerCase())
      );
    }

    // Limit results
    files = files.slice(0, pageSize);

    const result = {
      files: files.map(file => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        kind: file.kind,
        parents: file.parents,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
        size: file.size,
        webViewLink: file.webViewLink
      })),
      nextPageToken: files.length === pageSize ? 'mock-next-page-token' : undefined
    };

    return createMCPResponse(result, requestId);
  }

  private mockGetFile(args: any, requestId?: string): MCPResponse {
    if (!args?.fileId) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameter: fileId',
        requestId
      );
    }

    const file = this.mockFiles.get(args.fileId);
    if (!file) {
      return createMCPErrorResponse(
        -32603,
        `File not found: ${args.fileId}`,
        requestId
      );
    }

    const fileInfo = {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      kind: file.kind,
      parents: file.parents,
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
      size: file.size,
      webViewLink: file.webViewLink,
      downloadUrl: file.downloadUrl
    };

    return createMCPResponse({ file: fileInfo }, requestId);
  }

  private mockDownloadFile(args: any, requestId?: string): MCPResponse {
    if (!args?.fileId) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameter: fileId',
        requestId
      );
    }

    const file = this.mockFiles.get(args.fileId);
    if (!file) {
      return createMCPErrorResponse(
        -32603,
        `File not found: ${args.fileId}`,
        requestId
      );
    }

    // For Google Docs, Sheets, etc., we might need to export
    let content = file.content;
    if (!content) {
      if (file.mimeType.includes('google-apps')) {
        content = `Mock exported content for ${file.name}`;
      } else {
        return createMCPErrorResponse(
          -32603,
          `File content not available for download: ${args.fileId}`,
          requestId
        );
      }
    }

    return createMCPResponse({
      fileId: file.id,
      name: file.name,
      mimeType: args.mimeType || file.mimeType,
      content: content,
      size: content.length
    }, requestId);
  }

  private mockUploadFile(args: any, requestId?: string): MCPResponse {
    if (!args?.name || !args?.content) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameters: name, content',
        requestId
      );
    }

    const fileId = `mock-uploaded-${Date.now()}`;
    const mimeType = args.mimeType || 'text/plain';
    const parentId = args.parentId || 'root';

    const newFile = {
      id: fileId,
      name: args.name,
      mimeType: mimeType,
      kind: 'drive#file',
      parents: [parentId],
      createdTime: new Date().toISOString(),
      modifiedTime: new Date().toISOString(),
      size: args.content.length.toString(),
      webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
      content: args.content
    };

    this.mockFiles.set(fileId, newFile);

    return createMCPResponse({
      file: {
        id: newFile.id,
        name: newFile.name,
        mimeType: newFile.mimeType,
        parents: newFile.parents,
        webViewLink: newFile.webViewLink
      }
    }, requestId);
  }

  private mockCreateFolder(args: any, requestId?: string): MCPResponse {
    if (!args?.name) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameter: name',
        requestId
      );
    }

    const folderId = `mock-folder-${Date.now()}`;
    const parentId = args.parentId || 'root';

    const newFolder = {
      id: folderId,
      name: args.name,
      mimeType: 'application/vnd.google-apps.folder',
      kind: 'drive#file',
      parents: [parentId],
      createdTime: new Date().toISOString(),
      modifiedTime: new Date().toISOString()
    };

    this.mockFiles.set(folderId, newFolder);

    return createMCPResponse({
      folder: {
        id: newFolder.id,
        name: newFolder.name,
        mimeType: newFolder.mimeType,
        parents: newFolder.parents
      }
    }, requestId);
  }

  private mockShareFile(args: any, requestId?: string): MCPResponse {
    if (!args?.fileId || !args?.email) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameters: fileId, email',
        requestId
      );
    }

    const file = this.mockFiles.get(args.fileId);
    if (!file) {
      return createMCPErrorResponse(
        -32603,
        `File not found: ${args.fileId}`,
        requestId
      );
    }

    const role = args.role || 'reader';
    const permissionId = `mock-permission-${Date.now()}`;

    return createMCPResponse({
      permission: {
        id: permissionId,
        type: 'user',
        emailAddress: args.email,
        role: role,
        displayName: `Mock User (${args.email})`
      },
      shareLink: `https://drive.google.com/file/d/${args.fileId}/view?usp=sharing`
    }, requestId);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.options.port, () => {
        console.log(`Google Drive Mock Server running on port ${this.options.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Google Drive Mock Server stopped');
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

  // Add mock file for testing
  addMockFile(id: string, fileData: any): void {
    this.mockFiles.set(id, {
      id,
      kind: 'drive#file',
      createdTime: new Date().toISOString(),
      modifiedTime: new Date().toISOString(),
      ...fileData
    });
  }
}