export { GitHubMockServer } from './github-mock';
export { FilesystemMockServer } from './filesystem-mock';
export { GDriveMockServer } from './gdrive-mock';

import { GitHubMockServer } from './github-mock';
import { FilesystemMockServer } from './filesystem-mock';
import { GDriveMockServer } from './gdrive-mock';

export interface MockServerSuite {
  github: GitHubMockServer;
  filesystem: FilesystemMockServer;
  gdrive: GDriveMockServer;
}

export interface MockServerOptions {
  basePort?: number;
  delay?: number;
  errorRate?: number;
}

/**
 * Test helper class to manage multiple mock MCP servers.
 */
export class MockServerManager {
  private servers: MockServerSuite;
  private running: boolean = false;

  constructor(options: MockServerOptions = {}) {
    const basePort = options.basePort || 8001;
    const commonOptions = {
      delay: options.delay || 0,
      errorRate: options.errorRate || 0
    };
    this.servers = {
      github: new GitHubMockServer({ port: basePort, ...commonOptions }),
      filesystem: new FilesystemMockServer({ port: basePort + 1, ...commonOptions }),
      gdrive: new GDriveMockServer({ port: basePort + 2, ...commonOptions }),
    };
  }

  /**
   * Start all mock servers.
   */
  async startAll(): Promise<void> {
    if (this.running) {
      throw new Error('Mock servers are already running');
    }

    try {
      await Promise.all([
        this.servers.github.start(),
        this.servers.filesystem.start(),
        this.servers.gdrive.start(),
      ]);
      
      this.running = true;
      console.log('All mock MCP servers started successfully');
    } catch (error) {
      console.error('Failed to start mock servers:', error);
      await this.stopAll(); // Cleanup any started servers
      throw error;
    }
  }

  /**
   * Stop all mock servers.
   */
  async stopAll(): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      await Promise.all([
        this.servers.github.stop(),
        this.servers.filesystem.stop(),
        this.servers.gdrive.stop(),
      ]);
      
      this.running = false;
      console.log('All mock MCP servers stopped');
    } catch (error) {
      console.error('Error stopping mock servers:', error);
      throw error;
    }
  }

  /**
   * Get server URLs for configuration.
   */
  getServerUrls(): Record<string, string> {
    return {
      github: this.servers.github.getUrl(),
      filesystem: this.servers.filesystem.getUrl(),
      gdrive: this.servers.gdrive.getUrl(),
    };
  }

  /**
   * Get individual server instances for advanced testing.
   */
  getServers(): MockServerSuite {
    return this.servers;
  }

  /**
   * Check if servers are running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Set error rate for all servers.
   */
  setErrorRate(rate: number): void {
    Object.values(this.servers).forEach(server => {
      server.setErrorRate(rate);
    });
  }

  /**
   * Set delay for all servers.
   */
  setDelay(ms: number): void {
    Object.values(this.servers).forEach(server => {
      server.setDelay(ms);
    });
  }

  /**
   * Wait for servers to be ready (useful in tests).
   */
  async waitForReady(timeoutMs: number = 5000): Promise<void> {
    const startTime = Date.now();
    
    while (!this.running && (Date.now() - startTime) < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (!this.running) {
      throw new Error(`Mock servers not ready within ${timeoutMs}ms`);
    }
  }
}

/**
 * Create a test configuration for the proxy server using mock servers.
 */
export function createMockProxyConfig(serverUrls: Record<string, string>) {
  return {
    servers: {
      github: {
        name: 'github',
        url: serverUrls.github,
        timeout: 5000,
        maxRetries: 2,
        healthCheckPath: '/health'
      },
      filesystem: {
        name: 'filesystem',
        url: serverUrls.filesystem,
        timeout: 5000,
        maxRetries: 2,
        healthCheckPath: '/health'
      },
      gdrive: {
        name: 'gdrive',
        url: serverUrls.gdrive,
        timeout: 5000,
        maxRetries: 2,
        healthCheckPath: '/health'
      },
    },
    routing: {
      strategy: 'prefix' as const,
      rules: {
        github: 'github',
        gh: 'github',
        filesystem: 'filesystem',
        fs: 'filesystem',
        gdrive: 'gdrive',
        drive: 'gdrive',
        atlassian: 'atlassian',
        jira: 'atlassian'
      },
      defaultServer: 'filesystem'
    },
    logging: {
      level: 'INFO',
      format: 'json'
    },
    server: {
      port: 8000,
      host: '0.0.0.0'
    },
    llm: {
      provider: 'openai' as const,
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 4000
    },
    ui: {
      enabled: true,
      port: 3000,
      theme: 'light',
      max_conversation_history: 100
    }
  };
}