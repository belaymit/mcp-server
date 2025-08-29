import express from 'express';
import { MCPResponse, MCPRequest, createMCPResponse, createMCPErrorResponse } from '../../models';

export interface GitHubMockOptions {
  port?: number;
  delay?: number;
  errorRate?: number;
}

export class GitHubMockServer {
  private app: express.Application;
  private server: any;
  private options: GitHubMockOptions;

  constructor(options: GitHubMockOptions = {}) {
    this.options = {
      port: 8001,
      delay: 0,
      errorRate: 0,
      ...options
    };
    this.app = express();
    this.setupRoutes();
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
            message: 'Simulated server error'
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
      res.json({ status: 'healthy', server: 'github-mock' });
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
        name: 'get_repository',
        description: 'Get information about a GitHub repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' }
          },
          required: ['owner', 'repo']
        }
      },
      {
        name: 'list_issues',
        description: 'List issues in a GitHub repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' }
          },
          required: ['owner', 'repo']
        }
      },
      {
        name: 'create_issue',
        description: 'Create a new issue in a GitHub repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            title: { type: 'string', description: 'Issue title' },
            body: { type: 'string', description: 'Issue body' }
          },
          required: ['owner', 'repo', 'title']
        }
      },
      {
        name: 'get_user',
        description: 'Get information about a GitHub user',
        inputSchema: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'GitHub username' }
          },
          required: ['username']
        }
      }
    ];

    return createMCPResponse({ tools }, request.id);
  }

  private handleInvokeMethod(request: MCPRequest): MCPResponse {
    const { name, arguments: args } = request.params || {};

    switch (name) {
      case 'get_repository':
        return this.mockGetRepository(args, request.id);
      
      case 'list_issues':
        return this.mockListIssues(args, request.id);
      
      case 'create_issue':
        return this.mockCreateIssue(args, request.id);
      
      case 'get_user':
        return this.mockGetUser(args, request.id);
      
      default:
        return createMCPErrorResponse(
          -32601,
          `Tool '${name}' not found`,
          request.id
        );
    }
  }

  private mockGetRepository(args: any, requestId?: string): MCPResponse {
    if (!args?.owner || !args?.repo) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameters: owner, repo',
        requestId
      );
    }

    const mockRepo = {
      id: 123456,
      name: args.repo,
      full_name: `${args.owner}/${args.repo}`,
      owner: {
        login: args.owner,
        id: 12345,
        type: 'User'
      },
      description: `Mock repository for ${args.repo}`,
      private: false,
      html_url: `https://github.com/${args.owner}/${args.repo}`,
      clone_url: `https://github.com/${args.owner}/${args.repo}.git`,
      language: 'TypeScript',
      stargazers_count: 42,
      watchers_count: 15,
      forks_count: 8,
      open_issues_count: 3,
      created_at: '2023-01-01T00:00:00Z',
      updated_at: new Date().toISOString()
    };

    return createMCPResponse({ repository: mockRepo }, requestId);
  }

  private mockListIssues(args: any, requestId?: string): MCPResponse {
    if (!args?.owner || !args?.repo) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameters: owner, repo',
        requestId
      );
    }

    const state = args.state || 'open';
    const mockIssues = [
      {
        id: 1,
        number: 1,
        title: 'Fix login button alignment',
        body: 'The login button is misaligned on mobile devices',
        state: 'open',
        user: {
          login: 'developer1',
          id: 11111
        },
        labels: [
          { name: 'bug', color: 'ff0000' },
          { name: 'ui', color: '00ff00' }
        ],
        created_at: '2023-12-01T10:00:00Z',
        updated_at: '2023-12-01T15:30:00Z'
      },
      {
        id: 2,
        number: 2,
        title: 'Add MCP server integration',
        body: 'Implement MCP server for GitHub API access',
        state: state === 'all' ? 'closed' : state,
        user: {
          login: 'developer2',
          id: 22222
        },
        labels: [
          { name: 'enhancement', color: '0000ff' },
          { name: 'mcp', color: 'ffff00' }
        ],
        created_at: '2023-11-15T09:00:00Z',
        updated_at: '2023-11-20T14:45:00Z'
      }
    ];

    const filteredIssues = state === 'all' 
      ? mockIssues 
      : mockIssues.filter(issue => issue.state === state);

    return createMCPResponse({ issues: filteredIssues }, requestId);
  }

  private mockCreateIssue(args: any, requestId?: string): MCPResponse {
    if (!args?.owner || !args?.repo || !args?.title) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameters: owner, repo, title',
        requestId
      );
    }

    const mockIssue = {
      id: Math.floor(Math.random() * 100000),
      number: Math.floor(Math.random() * 1000) + 1,
      title: args.title,
      body: args.body || '',
      state: 'open',
      user: {
        login: 'api-user',
        id: 99999
      },
      labels: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      html_url: `https://github.com/${args.owner}/${args.repo}/issues/${Math.floor(Math.random() * 1000) + 1}`
    };

    return createMCPResponse({ issue: mockIssue }, requestId);
  }

  private mockGetUser(args: any, requestId?: string): MCPResponse {
    if (!args?.username) {
      return createMCPErrorResponse(
        -32602,
        'Missing required parameter: username',
        requestId
      );
    }

    const mockUser = {
      id: 54321,
      login: args.username,
      name: `Mock User (${args.username})`,
      email: `${args.username}@example.com`,
      bio: `This is a mock user profile for ${args.username}`,
      company: 'Mock Company',
      location: 'Mock City',
      public_repos: 25,
      public_gists: 5,
      followers: 100,
      following: 50,
      created_at: '2020-01-01T00:00:00Z',
      updated_at: new Date().toISOString(),
      html_url: `https://github.com/${args.username}`,
      avatar_url: `https://github.com/identicons/${args.username}.png`
    };

    return createMCPResponse({ user: mockUser }, requestId);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.options.port, () => {
        console.log(`GitHub Mock Server running on port ${this.options.port}`);
        resolve();
      });
      this.server.on('error', (error: any) => {
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('GitHub Mock Server stopped');
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
}