import express from "express";
import { createServer } from "http";
import { ConfigurationManager, ProxyConfig } from "./config";
import { createLogger } from "./logger";
import {
  createChatMessage,
  createServerStatus,
  ChatMessage,
  ServerStatus,
} from "./models";
import { MCPStdioClient, MCPServerConfig } from "./mcp-stdio-client";
import { LLMIntegrationService } from "./llm-integration";

const logger = createLogger("web-ui-server");

export class WebUIServer {
  private app: express.Application;
  private server: any;
  private config: ProxyConfig;
  private chatHistory: ChatMessage[] = [];
  private serverStatuses: ServerStatus[] = [];
  private llmService: LLMIntegrationService;

  constructor(config: ProxyConfig) {
    this.config = config;
    this.app = express();
    this.server = createServer(this.app);
    this.llmService = new LLMIntegrationService(config.llm);

    this.setupMiddleware();
    this.setupRoutes();
    // Initialize server statuses asynchronously
    this.initializeServerStatuses().catch((error) => {
      logger.error("Failed to initialize server statuses:", error);
    });
  }

  private setupMiddleware(): void {
    // Enable CORS manually
    this.app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization"
      );

      if (req.method === "OPTIONS") {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    // Parse JSON bodies
    this.app.use(express.json());

    // Serve static files (for the frontend)
    this.app.use(express.static("public"));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get("User-Agent"),
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        ui_enabled: this.config.ui.enabled,
      });
    });

    // Get configuration info
    this.app.get("/api/config", (req, res) => {
      res.json({
        ui: {
          theme: this.config.ui.theme,
          max_conversation_history: this.config.ui.max_conversation_history,
          allowed_servers: this.config.ui.allowed_servers,
        },
        servers: Object.keys(this.config.servers),
      });
    });

    // Get server statuses
    this.app.get("/api/servers", (req, res) => {
      res.json(this.serverStatuses);
    });

    // Refresh server statuses manually
    this.app.post("/api/servers/refresh", async (req, res) => {
      try {
        await this.refreshServerStatuses();
        res.json({
          message: "Server statuses refreshed successfully",
          servers: this.serverStatuses,
        });
      } catch (error) {
        logger.error("Error refreshing server statuses:", error);
        res.status(500).json({ error: "Failed to refresh server statuses" });
      }
    });

    // Get chat history
    this.app.get("/api/chat/history", (req, res) => {
      const limit =
        parseInt(req.query.limit as string) ||
        this.config.ui.max_conversation_history;
      const history = this.chatHistory.slice(-limit);
      res.json(history);
    });

    // Send a chat message
    this.app.post("/api/chat/message", async (req, res) => {
      try {
        const { content } = req.body;

        logger.info("Received chat message:", { content });

        if (!content || typeof content !== "string") {
          return res.status(400).json({ error: "Message content is required" });
        }

        // Create user message
        const userMessage = createChatMessage(content, "user");
        this.chatHistory.push(userMessage);

        // Update LLM service with current available tools
        const availableTools = new Map<string, string[]>();
        for (const serverStatus of this.serverStatuses) {
          if (
            serverStatus.status === "online" &&
            serverStatus.available_tools.length > 0
          ) {
            availableTools.set(serverStatus.name, serverStatus.available_tools);
          }
        }
        this.llmService.updateAvailableTools(availableTools);

        logger.info("Available tools updated:", {
          toolCount: availableTools.size,
        });

        // Process the message with LLM integration
        const mcpServerConfigs = await this.loadMCPServerConfigs();
        logger.info("MCP server configs loaded:", {
          configCount: Object.keys(mcpServerConfigs).length,
        });

        // For now, just call the LLM directly without MCP tools if no configs are available
        let llmResponse: string;
        if (Object.keys(mcpServerConfigs).length === 0) {
          // No MCP servers configured, just use LLM directly
          logger.info("No MCP servers configured, using LLM directly");
          llmResponse = await this.llmService.callLLMDirectly(content);
        } else {
          llmResponse = await this.llmService.processPrompt(
            content,
            mcpServerConfigs
          );
        }

        const assistantMessage = createChatMessage(llmResponse, "assistant");
        this.chatHistory.push(assistantMessage);

        // Trim chat history if it exceeds the limit
        if (this.chatHistory.length > this.config.ui.max_conversation_history) {
          this.chatHistory = this.chatHistory.slice(
            -this.config.ui.max_conversation_history
          );
        }

        res.json({
          user_message: userMessage,
          assistant_message: assistantMessage,
        });
      } catch (error) {
        logger.error("Error processing chat message:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Clear chat history
    this.app.delete("/api/chat/history", (req, res) => {
      this.chatHistory = [];
      res.json({ message: "Chat history cleared" });
    });

    // Serve the main UI page
    this.app.get("/", (req, res) => {
      res.send(this.generateUIHTML());
    });
  }

  private async initializeServerStatuses(): Promise<void> {
    // Load the actual MCP server configurations from .kiro/settings/mcp.json
    const mcpServerConfigs = await this.loadMCPServerConfigs();

    // Initialize server statuses based on actual MCP configurations
    for (const [name, serverConfig] of Object.entries(mcpServerConfigs)) {
      const status = createServerStatus(
        name,
        `MCP STDIO: ${serverConfig.command}`, // Show the actual command instead of HTTP URL
        "offline", // Start as offline, will be updated by health checks
        [] // Will be populated when we implement tool discovery
      );
      this.serverStatuses.push(status);
    }

    // Start periodic server status updates
    this.refreshServerStatuses();
    setInterval(() => this.refreshServerStatuses(), 30000); // Refresh every 30 seconds
  }

  /**
   * Refresh server statuses by checking health and discovering tools
   */
  private async refreshServerStatuses(): Promise<void> {
    logger.info("Refreshing server statuses and discovering tools...");

    // Load the actual MCP server configurations from .kiro/settings/mcp.json
    const mcpServerConfigs = await this.loadMCPServerConfigs();

    const refreshPromises = this.serverStatuses.map(
      async (serverStatus, index) => {
        const mcpConfig = mcpServerConfigs[serverStatus.name];
        if (!mcpConfig) {
          logger.warn(
            `No MCP configuration found for server: ${serverStatus.name}`
          );
          return;
        }

        const client = new MCPStdioClient(mcpConfig);

        try {
          // Check server health and connect
          const isHealthy = await client.checkHealth();

          if (isHealthy) {
            // Discover available tools
            const tools = await client.getAvailableTools();

            // Update server status
            this.serverStatuses[index] = {
              ...serverStatus,
              status: "online",
              available_tools: tools,
              last_check: new Date(),
            };

            logger.info(
              `Server ${serverStatus.name} is online with ${tools.length} tools`,
              {
                server: serverStatus.name,
                tools: tools,
              }
            );

            // Disconnect after getting tools
            await client.disconnect();
          } else {
            // Server is offline
            this.serverStatuses[index] = {
              ...serverStatus,
              status: "offline",
              available_tools: [],
              last_check: new Date(),
            };

            logger.warn(`Server ${serverStatus.name} is offline`, {
              server: serverStatus.name,
            });
          }
        } catch (error: any) {
          // Server has an error
          this.serverStatuses[index] = {
            ...serverStatus,
            status: "error",
            available_tools: [],
            last_check: new Date(),
          };

          logger.error(`Error checking server ${serverStatus.name}:`, {
            server: serverStatus.name,
            error: error.message,
          });

          // Make sure to disconnect on error
          try {
            await client.disconnect();
          } catch (disconnectError) {
            // Ignore disconnect errors
          }
        }
      }
    );

    await Promise.all(refreshPromises);
    logger.info("Server status refresh completed");
  }

  /**
   * Load MCP server configurations from .kiro/settings/mcp.json
   */
  private async loadMCPServerConfigs(): Promise<
    Record<string, MCPServerConfig>
  > {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");

      // Try workspace-level config first
      const workspaceConfigPath = ".kiro/settings/mcp.json";
      let mcpConfig: any = {};

      try {
        const configContent = await fs.readFile(workspaceConfigPath, "utf-8");
        mcpConfig = JSON.parse(configContent);
        logger.info("Loaded workspace MCP configuration");
      } catch (error) {
        logger.warn(
          "No workspace MCP configuration found, trying user-level config"
        );

        // Try user-level config
        const os = await import("os");
        const userConfigPath = path.join(
          os.homedir(),
          ".kiro",
          "settings",
          "mcp.json"
        );
        try {
          const configContent = await fs.readFile(userConfigPath, "utf-8");
          mcpConfig = JSON.parse(configContent);
          logger.info("Loaded user-level MCP configuration");
        } catch (userError) {
          logger.error("No MCP configuration found at workspace or user level");
          return {};
        }
      }

      const serverConfigs: Record<string, MCPServerConfig> = {};

      if (mcpConfig.mcpServers) {
        for (const [name, config] of Object.entries(mcpConfig.mcpServers)) {
          const serverConfig = config as any;
          serverConfigs[name] = {
            name,
            command: serverConfig.command,
            args: serverConfig.args || [],
            env: serverConfig.env || {},
          };
        }
      }

      logger.info(
        `Loaded ${Object.keys(serverConfigs).length} MCP server configurations`
      );
      return serverConfigs;
    } catch (error: any) {
      logger.error("Failed to load MCP server configurations:", error.message);
      return {};
    }
  }

  private generateUIHTML(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP Proxy Server - Web UI</title>

    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: ${this.config.ui.theme === "dark" ? "#1a1a1a" : "#f5f5f5"};
            color: ${this.config.ui.theme === "dark" ? "#ffffff" : "#333333"};
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .header {
            background: ${this.config.ui.theme === "dark" ? "#2d2d2d" : "#ffffff"};
            padding: 1rem;
            border-bottom: 1px solid ${this.config.ui.theme === "dark" ? "#404040" : "#e0e0e0"};
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .header h1 {
            font-size: 1.5rem;
            font-weight: 600;
        }
        
        .main-container {
            display: flex;
            flex: 1;
            overflow: hidden;
        }
        
        .sidebar {
            width: 300px;
            background: ${this.config.ui.theme === "dark" ? "#252525" : "#ffffff"};
            border-right: 1px solid ${this.config.ui.theme === "dark" ? "#404040" : "#e0e0e0"};
            padding: 1rem;
            overflow-y: auto;
        }
        
        .sidebar h2 {
            font-size: 1.1rem;
            margin-bottom: 1rem;
            color: ${this.config.ui.theme === "dark" ? "#cccccc" : "#666666"};
        }
        
        .server-status {
            margin-bottom: 1rem;
            padding: 0.75rem;
            border-radius: 8px;
            background: ${this.config.ui.theme === "dark" ? "#333333" : "#f8f9fa"};
        }
        
        .server-name {
            font-weight: 600;
            margin-bottom: 0.25rem;
        }
        
        .server-url {
            font-size: 0.85rem;
            color: ${this.config.ui.theme === "dark" ? "#999999" : "#666666"};
            margin-bottom: 0.25rem;
        }
        
        .status-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 0.5rem;
        }
        
        .status-online { background: #10b981; }
        .status-offline { background: #ef4444; }
        .status-error { background: #f59e0b; }
        
        .chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: ${this.config.ui.theme === "dark" ? "#1e1e1e" : "#ffffff"};
        }
        
        .chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 1rem;
        }
        
        .message {
            margin-bottom: 1rem;
            padding: 0.75rem 1rem;
            border-radius: 12px;
            max-width: 80%;
        }
        
        .message.user {
            background: #3b82f6;
            color: white;
            margin-left: auto;
        }
        
        .message.assistant {
            background: ${this.config.ui.theme === "dark" ? "#374151" : "#f3f4f6"};
            color: ${this.config.ui.theme === "dark" ? "#ffffff" : "#333333"};
        }
        
        .message-time {
            font-size: 0.75rem;
            opacity: 0.7;
            margin-top: 0.25rem;
        }
        
        .chat-input-container {
            padding: 1rem;
            border-top: 1px solid ${this.config.ui.theme === "dark" ? "#404040" : "#e0e0e0"};
            background: ${this.config.ui.theme === "dark" ? "#252525" : "#ffffff"};
        }
        
        .chat-input-form {
            display: flex;
            gap: 0.5rem;
        }
        
        .chat-input {
            flex: 1;
            padding: 0.75rem;
            border: 1px solid ${this.config.ui.theme === "dark" ? "#404040" : "#d1d5db"};
            border-radius: 8px;
            background: ${this.config.ui.theme === "dark" ? "#333333" : "#ffffff"};
            color: ${this.config.ui.theme === "dark" ? "#ffffff" : "#333333"};
            font-size: 1rem;
        }
        
        .chat-input:focus {
            outline: none;
            border-color: #3b82f6;
        }
        
        .send-button {
            padding: 0.75rem 1.5rem;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
        }
        
        .send-button:hover {
            background: #2563eb;
        }
        
        .send-button:disabled {
            background: #9ca3af;
            cursor: not-allowed;
        }
        
        .connection-status {
            padding: 0.5rem 1rem;
            text-align: center;
            font-size: 0.85rem;
            background: ${this.config.ui.theme === "dark" ? "#1f2937" : "#f9fafb"};
            border-bottom: 1px solid ${this.config.ui.theme === "dark" ? "#374151" : "#e5e7eb"};
        }
        
        .connected { color: #10b981; }
        .disconnected { color: #ef4444; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔗 MCP Proxy Server - Web UI</h1>
    </div>
    
    <div class="connection-status" id="connectionStatus">
        <span class="disconnected">Connecting...</span>
    </div>
    
    <div class="main-container">
        <div class="sidebar">
            <h2>📊 Server Status</h2>
            <div id="serverStatuses">
                <!-- Server statuses will be populated here -->
            </div>
        </div>
        
        <div class="chat-container">
            <div class="chat-messages" id="chatMessages">
                <!-- Chat messages will appear here -->
            </div>
            
            <div class="chat-input-container">
                <form class="chat-input-form" id="chatForm">
                    <input 
                        type="text" 
                        class="chat-input" 
                        id="chatInput" 
                        placeholder="Ask me anything about your MCP servers..."
                        autocomplete="off"
                    >
                    <button type="submit" class="send-button" id="sendButton">Send</button>
                </form>
            </div>
        </div>
    </div>

    <script>
        // DOM elements
        const connectionStatus = document.getElementById('connectionStatus');
        const serverStatuses = document.getElementById('serverStatuses');
        const chatMessages = document.getElementById('chatMessages');
        const chatForm = document.getElementById('chatForm');
        const chatInput = document.getElementById('chatInput');
        const sendButton = document.getElementById('sendButton');
        
        let lastMessageCount = 0;
        
        // Initialize the UI
        async function initializeUI() {
            try {
                // Load server statuses
                await loadServerStatuses();
                
                // Load chat history
                await loadChatHistory();
                
                connectionStatus.innerHTML = '<span class="connected">✅ Connected</span>';
                
                // Start polling for updates every 2 seconds
                setInterval(pollForUpdates, 2000);
                
            } catch (error) {
                console.error('Failed to initialize UI:', error);
                connectionStatus.innerHTML = '<span class="disconnected">❌ Connection Failed</span>';
            }
        }
        
        // Load server statuses
        async function loadServerStatuses() {
            try {
                const response = await fetch('/api/servers');
                if (response.ok) {
                    const statuses = await response.json();
                    updateServerStatuses(statuses);
                }
            } catch (error) {
                console.error('Failed to load server statuses:', error);
            }
        }
        
        // Load chat history
        async function loadChatHistory() {
            try {
                const response = await fetch('/api/chat/history');
                if (response.ok) {
                    const history = await response.json();
                    chatMessages.innerHTML = '';
                    history.forEach(message => addMessage(message));
                    lastMessageCount = history.length;
                    scrollToBottom();
                }
            } catch (error) {
                console.error('Failed to load chat history:', error);
            }
        }
        
        // Poll for updates
        async function pollForUpdates() {
            try {
                const response = await fetch('/api/chat/history');
                if (response.ok) {
                    const history = await response.json();
                    if (history.length > lastMessageCount) {
                        // New messages available
                        const newMessages = history.slice(lastMessageCount);
                        newMessages.forEach(message => addMessage(message));
                        lastMessageCount = history.length;
                        scrollToBottom();
                    }
                }
            } catch (error) {
                console.error('Failed to poll for updates:', error);
            }
        }
        
        // Chat form submission
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const content = chatInput.value.trim();
            
            if (!content) return;
            
            // Disable input while sending
            chatInput.disabled = true;
            sendButton.disabled = true;
            sendButton.textContent = 'Sending...';
            
            try {
                const response = await fetch('/api/chat/message', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ content }),
                });
                
                if (!response.ok) {
                    throw new Error('Failed to send message');
                }
                
                const result = await response.json();
                
                // Add both messages to the UI immediately
                addMessage(result.user_message);
                addMessage(result.assistant_message);
                lastMessageCount += 2;
                scrollToBottom();
                
                chatInput.value = '';
                
            } catch (error) {
                console.error('Error sending message:', error);
                alert('Failed to send message. Please try again.');
            } finally {
                // Re-enable input
                chatInput.disabled = false;
                sendButton.disabled = false;
                sendButton.textContent = 'Send';
                chatInput.focus();
            }
        });
        
        // Helper functions
        function updateServerStatuses(statuses) {
            serverStatuses.innerHTML = statuses.map(status => {
                const toolsDisplay = status.available_tools.length > 0 
                    ? \`\${status.available_tools.length} tools: \${status.available_tools.join(', ')}\`
                    : status.status === 'offline' 
                        ? 'Offline - No tools available'
                        : status.status === 'error'
                            ? 'Error - Cannot connect'
                            : 'Discovering tools...';
                
                return \`
                    <div class="server-status">
                        <div class="server-name">
                            <span class="status-indicator status-\${status.status}"></span>
                            \${status.name}
                        </div>
                        <div class="server-url">\${status.url}</div>
                        <div style="font-size: 0.8rem; color: #666; margin-top: 0.25rem; word-wrap: break-word;">
                            \${toolsDisplay}
                        </div>
                    </div>
                \`;
            }).join('');
        }
        
        function addMessage(message) {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${message.role}\`;
            
            const time = new Date(message.timestamp).toLocaleTimeString();
            messageDiv.innerHTML = \`
                <div>\${message.content}</div>
                <div class="message-time">\${time}</div>
            \`;
            
            chatMessages.appendChild(messageDiv);
        }
        
        function scrollToBottom() {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        // Initialize when page loads
        document.addEventListener('DOMContentLoaded', () => {
            initializeUI();
            chatInput.focus();
        });
    </script>
</body>
</html>
    `;
  }

  async start(port?: number): Promise<void> {
    const uiPort = port || this.config.ui.port;

    return new Promise((resolve, reject) => {
      this.server.listen(uiPort, (error: any) => {
        if (error) {
          reject(error);
        } else {
          logger.info(`Web UI Server started on port ${uiPort}`);
          logger.info(`Open http://localhost:${uiPort} to access the UI`);
          resolve();
        }
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info("Web UI Server stopped");
        resolve();
      });
    });
  }
}
