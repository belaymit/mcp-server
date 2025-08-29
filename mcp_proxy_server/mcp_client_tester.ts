import { spawn, ChildProcess } from "child_process";
import { MCPRequest, MCPResponse, createMCPRequest } from "./models";
import * as http from "http";

interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  testMethod?: {
    name: string;
    params: Record<string, any>;
  };
}

export class MCPClientTester {
  private process: ChildProcess | null = null;
  private requestId = 1;
  private responses: string[] = [];

  /**
   * Start an MCP server process
   */
  async startServer(config: MCPServerConfig): Promise<void> {
    const env = { ...process.env, ...config.env };

    this.process = spawn(config.command, config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error("Failed to create process pipes");
    }

    // Handle server output
    this.process.stdout.on("data", (data: Buffer) => {
      const output = data.toString().trim();
      if (output) {
        // Split by lines in case multiple JSON responses come together
        const lines = output.split("\n").filter((line) => line.trim());
        for (const line of lines) {
          try {
            const jsonResponse = JSON.parse(line);
            console.log(
              `📤 MCP Response: ${JSON.stringify(jsonResponse, null, 2)}`
            );
            this.responses.push(line);
          } catch (e) {
            // Not JSON, probably server startup message
            console.log(`📤 Server Output: ${line}`);
          }
        }
      }
    });

    // Handle server errors
    this.process.stderr?.on("data", (data: Buffer) => {
      const error = data.toString().trim();
      if (error) {
        console.log(`❌ Server Error: ${error}`);
      }
    });

    // Handle process exit
    this.process.on("exit", (code: number | null) => {
      console.log(`🔚 Server process exited with code: ${code}`);
    });

    // Give the server time to start
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(`✅ ${config.name} server started`);
  }

  /**
   * Send a request to the MCP server via STDIO
   */
  async sendRequest(request: MCPRequest): Promise<void> {
    if (!this.process || !this.process.stdin) {
      throw new Error("Server process not started");
    }

    const requestJson = JSON.stringify(request);
    console.log(`📨 Sending request: ${requestJson}`);
    this.process.stdin.write(requestJson + "\n");
  }

  /**
   * Send initialize request (MCP protocol)
   */
  async initialize(): Promise<void> {
    const request = createMCPRequest(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "mcp-client-tester",
          version: "1.0.0",
        },
      },
      `req-${this.requestId++}`
    );
    await this.sendRequest(request);
  }

  /**
   * Send tools/list request (MCP protocol)
   */
  async getMethods(): Promise<void> {
    const request = createMCPRequest(
      "tools/list",
      {},
      `req-${this.requestId++}`
    );
    await this.sendRequest(request);
  }

  /**
   * Send tools/call request (MCP protocol)
   */
  async invokeMethod(
    method: string,
    params: Record<string, any>
  ): Promise<void> {
    const request = createMCPRequest(
      "tools/call",
      { name: method, arguments: params },
      `req-${this.requestId++}`
    );
    await this.sendRequest(request);
  }

  /**
   * Stop the server process
   */
  async stopServer(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  /**
   * Get all responses received
   */
  getResponses(): string[] {
    return [...this.responses];
  }

  /**
   * Clear responses
   */
  clearResponses(): void {
    this.responses = [];
  }
}

/**
 * Test a specific MCP server
 */
export async function testServer(config: MCPServerConfig): Promise<string[]> {
  const tester = new MCPClientTester();

  try {
    await tester.startServer(config);

    // Wait a bit for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Initialize the MCP connection first
    await tester.initialize();
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Test tools/list
    await tester.getMethods();
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Test tools/call if specified
    if (config.testMethod) {
      await tester.invokeMethod(
        config.testMethod.name,
        config.testMethod.params
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    return tester.getResponses();
  } catch (error) {
    return [];
  } finally {
    await tester.stopServer();
  }
}

/**
 * Main testing function
 */
export async function runAllTests(): Promise<void> {
  // Test GitHub MCP Server
  console.log("\n📂 Testing GitHub MCP Server...");
  const githubConfig: MCPServerConfig = {
    name: "GitHub MCP Server",
    command: "cmd",
    args: ["/c", "npx", "-y", "@cyanheads/git-mcp-server"],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN:
        process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "your_token_here",
    },
    testMethod: {
      name: "git_set_working_dir",
      params: { path: process.cwd() },
    },
  };

  const githubResponses = await testServer(githubConfig);
  console.log(
    `✅ GitHub server test completed. Responses: ${githubResponses.length}`
  );

  // Test Filesystem MCP Server
  console.log("\n📁 Testing Filesystem MCP Server...");
  const filesystemConfig: MCPServerConfig = {
    name: "Filesystem MCP Server",
    command: "cmd",
    args: [
      "/c",
      "npx",
      "-y",
      "@modelcontextprotocol/server-filesystem",
      process.cwd(),
    ],
    testMethod: {
      name: "read_file",
      params: { path: "package.json" },
    },
  };

  const filesystemResponses = await testServer(filesystemConfig);
  console.log(
    `✅ Filesystem server test completed. Responses: ${filesystemResponses.length}`
  );

  // Test Google Drive MCP Server
  console.log("\n☁️ Testing Google Drive MCP Server...");
  const gdriveConfig: MCPServerConfig = {
    name: "Google Drive MCP Server",
    command: "cmd",
    args: ["/c", "npx", "-y", "@isaacphi/mcp-gdrive"],
    testMethod: {
      name: "gdrive_search",
      params: { query: "test" },
    },
  };

  const gdriveResponses = await testServer(gdriveConfig);
  console.log(
    `✅ Google Drive server test completed. Responses: ${gdriveResponses.length}`
  );
}

// Run tests if this script is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}
