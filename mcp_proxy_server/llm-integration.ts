import axios from 'axios';
import { createLogger } from './logger';
import { LLMConfig } from './config';
import { MCPStdioClient, MCPServerConfig } from './mcp-stdio-client';
import { createMCPRequest } from './models';

const logger = createLogger('llm-integration');

export interface ToolCall {
  id: string;
  name: string;
  server: string;
  parameters: Record<string, any>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
}

export class LLMIntegrationService {
  private config: LLMConfig;
  private availableTools: Map<string, string[]> = new Map(); // server -> tools

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /**
   * Update the available tools from MCP servers
   */
  updateAvailableTools(serverTools: Map<string, string[]>): void {
    this.availableTools = new Map(serverTools);
    logger.info(`Updated available tools from ${serverTools.size} servers`);
  }

  /**
   * Call LLM directly without MCP tools
   */
  async callLLMDirectly(prompt: string): Promise<string> {
    try {
      const toolDescriptions = this.createToolDescriptions();
      return await this.callLLM(prompt, toolDescriptions);
    } catch (error: any) {
      logger.error('Error calling LLM directly:', error);
      return `I encountered an error while processing your request: ${error.message}`;
    }
  }

  /**
   * Process a user prompt and potentially execute MCP tools
   */
  async processPrompt(prompt: string, mcpServerConfigs: Record<string, MCPServerConfig>): Promise<string> {
    try {
      // Create tool descriptions for the LLM
      const toolDescriptions = this.createToolDescriptions();
      
      // Send prompt to LLM with tool information
      const llmResponse = await this.callLLM(prompt, toolDescriptions);
      
      // Check if LLM wants to use tools
      const toolCalls = this.extractToolCalls(llmResponse);
      
      if (toolCalls.length > 0) {
        logger.info(`LLM requested ${toolCalls.length} tool calls`);
        
        // Execute the tool calls
        const toolResults = await this.executeToolCalls(toolCalls, mcpServerConfigs);
        
        // Send results back to LLM for final response
        const finalResponse = await this.formatFinalResponse(prompt, toolCalls, toolResults);
        return finalResponse;
      }
      
      return llmResponse;
      
    } catch (error: any) {
      logger.error('Error processing prompt:', error);
      return `I encountered an error while processing your request: ${error.message}`;
    }
  }

  /**
   * Create tool descriptions for the LLM
   */
  private createToolDescriptions(): string {
    const descriptions: string[] = [];
    
    for (const [server, tools] of this.availableTools) {
      descriptions.push(`**${server.toUpperCase()} Server Tools:**`);
      
      for (const tool of tools) {
        let description = `- ${tool}`;
        
        // Add specific descriptions for known tools
        if (tool.startsWith('git_')) {
          description += ` (Git operation: ${tool.replace('git_', '').replace('_', ' ')})`;
        } else if (tool.startsWith('read_')) {
          description += ` (File reading operation)`;
        } else if (tool.startsWith('write_')) {
          description += ` (File writing operation)`;
        } else if (tool.startsWith('gdrive_')) {
          description += ` (Google Drive operation)`;
        } else if (tool.startsWith('gsheets_')) {
          description += ` (Google Sheets operation)`;
        }
        
        descriptions.push(description);
      }
      descriptions.push('');
    }
    
    return descriptions.join('\n');
  }

  /**
   * Call the LLM with the prompt and available tools
   */
  private async callLLM(prompt: string, toolDescriptions: string): Promise<string> {
    const systemPrompt = `You are an AI assistant with access to MCP (Model Context Protocol) tools. You can help users with various tasks using these available tools:

${toolDescriptions}

When a user asks for something that can be accomplished with these tools, you should:
1. Identify which tool(s) would be helpful
2. Use the format: TOOL_CALL: server_name.tool_name(parameters)
3. Provide a helpful response

For example:
- For file operations: Use filesystem server tools
- For git operations: Use github server tools  
- For Google Drive/Sheets: Use gdrive server tools

Available servers: ${Array.from(this.availableTools.keys()).join(', ')}`;

    if (this.config.provider === 'openai') {
      return await this.callOpenAI(systemPrompt, prompt);
    } else if (this.config.provider === 'gemini') {
      return await this.callGemini(systemPrompt, prompt);
    } else {
      // Fallback to simple response for now
      return `I can help you with various tasks using the available MCP tools. I have access to ${Array.from(this.availableTools.keys()).join(', ')} servers with ${Array.from(this.availableTools.values()).flat().length} total tools. What would you like me to help you with?`;
    }
  }

  /**
   * Call Google Gemini API
   */
  private async callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
    // Get API key from config or environment variable
    const apiKey = this.config.api_key || process.env.GEMINI_API_KEY;
    
    logger.info('Gemini API call debug:', {
      hasApiKey: !!apiKey,
      apiKeySource: this.config.api_key ? 'config' : 'env',
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.max_tokens
    });
    
    if (!apiKey) {
      return `I need a Google Gemini API key to provide intelligent responses. Please set the GEMINI_API_KEY environment variable or configure it in your proxy_config.yaml file.

However, I can tell you about the available MCP tools:
${this.createToolDescriptions()}

You have ${Array.from(this.availableTools.values()).flat().length} tools available across ${this.availableTools.size} servers!`;
    }

    try {
      // Create a focused prompt that explains the limitations and provides alternatives
      const simplePrompt = `You are a helpful AI assistant with access to Git tools (not GitHub API tools). 

The available tools are for local Git repository management:
- git_remote: manages remotes for local repositories
- git_status: shows local repository status  
- git_log: shows local commit history
- git_branch: manages local branches

User question: ${userPrompt}

IMPORTANT: The available tools cannot query GitHub's API to list a user's repositories. The git_remote tool only works with local Git repositories that are already cloned.

To get information about GitHub user repositories, you would need:
1. GitHub API access (not available with current tools)
2. Or clone specific repositories first using git_clone

Please explain this limitation to the user and suggest alternatives like:
- Using GitHub's website directly
- Using GitHub CLI (gh) if installed
- Cloning specific repositories if they know the repository names`;
      
      const requestUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent`;
      logger.info('Making Gemini API request:', { url: requestUrl, model: this.config.model, promptLength: simplePrompt.length });
      
      const response = await axios.post(
        requestUrl,
        {
          contents: [{
            parts: [{
              text: simplePrompt
            }]
          }],
          generationConfig: {
            temperature: this.config.temperature,
            maxOutputTokens: this.config.max_tokens,
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': apiKey
          },
          timeout: 30000 // 30 second timeout
        }
      );

      const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) {
        throw new Error('No content received from Gemini API');
      }

      return content;
    } catch (error: any) {
      logger.error('Gemini API error details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          headers: error.config?.headers
        }
      });
      
      if (error.response?.status === 400) {
        return `Invalid request to Gemini API. Status: ${error.response?.status}. Error: ${JSON.stringify(error.response?.data)}`;
      } else if (error.response?.status === 403) {
        return `Access denied to Gemini API. Status: ${error.response?.status}. Error: ${JSON.stringify(error.response?.data)}`;
      } else if (error.response?.status === 429) {
        return 'Gemini API rate limit exceeded. Please try again in a moment.';
      } else {
        return `Gemini API error: ${error.message}. Status: ${error.response?.status}. Details: ${JSON.stringify(error.response?.data)}`;
      }
    }
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
    // Get API key from config or environment variable
    const apiKey = this.config.api_key || process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      return `I need an OpenAI API key to provide intelligent responses. Please set the OPENAI_API_KEY environment variable or configure it in your proxy_config.yaml file.

However, I can tell you about the available MCP tools:
${this.createToolDescriptions()}

You have ${Array.from(this.availableTools.values()).flat().length} tools available across ${this.availableTools.size} servers!`;
    }

    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: this.config.temperature,
        max_tokens: this.config.max_tokens
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      return response.data.choices[0].message.content;
    } catch (error: any) {
      logger.error('OpenAI API error:', error.response?.data || error.message);
      
      if (error.response?.status === 401) {
        return 'Invalid OpenAI API key. Please check your API key configuration.';
      } else if (error.response?.status === 429) {
        return 'OpenAI API rate limit exceeded. Please try again in a moment.';
      } else {
        return `I encountered an error while processing your request: ${error.message}. However, I can still help you understand what MCP tools are available!`;
      }
    }
  }

  /**
   * Extract tool calls from LLM response
   */
  private extractToolCalls(llmResponse: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const toolCallRegex = /TOOL_CALL:\s*(\w+)\.(\w+)\(([^)]*)\)/g;
    
    let match;
    while ((match = toolCallRegex.exec(llmResponse)) !== null) {
      const [, server, toolName, paramsStr] = match;
      
      // Parse parameters (improved JSON parsing)
      let parameters: Record<string, any> = {};
      try {
        if (paramsStr.trim()) {
          // Handle both {"key": "value"} and {key: "value"} formats
          let cleanParams = paramsStr.trim();
          
          // If it's already a complete JSON object, parse it directly
          if (cleanParams.startsWith('{') && cleanParams.endsWith('}')) {
            parameters = JSON.parse(cleanParams);
          } else {
            // Otherwise, wrap it in braces and parse
            const wrappedParams = `{${cleanParams}}`;
            parameters = JSON.parse(wrappedParams.replace(/'/g, '"'));
          }
        }
        
        // For git_remote, ensure mode parameter is set
        if (toolName === 'git_remote' && !parameters.mode) {
          parameters.mode = 'list'; // Default to list mode
        }
        
      } catch (error) {
        logger.warn(`Failed to parse tool parameters: ${paramsStr}`, error);
        
        // Fallback: provide default parameters for known tools
        if (toolName === 'git_remote') {
          parameters = { mode: 'list' };
        }
      }
      
      toolCalls.push({
        id: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: toolName,
        server,
        parameters
      });
    }
    
    return toolCalls;
  }

  /**
   * Execute tool calls using MCP clients
   */
  private async executeToolCalls(
    toolCalls: ToolCall[], 
    mcpServerConfigs: Record<string, MCPServerConfig>
  ): Promise<Record<string, any>[]> {
    const results: Record<string, any>[] = [];
    
    for (const toolCall of toolCalls) {
      try {
        logger.info(`Executing tool: ${toolCall.server}.${toolCall.name}`, { parameters: toolCall.parameters });
        
        const serverConfig = mcpServerConfigs[toolCall.server];
        if (!serverConfig) {
          results.push({ error: `Server ${toolCall.server} not found` });
          continue;
        }
        
        const client = new MCPStdioClient(serverConfig);
        
        // Actually call the tool using the MCP client
        const toolResult = await client.callTool(toolCall.name, toolCall.parameters);
        
        results.push({
          toolCall: toolCall.name,
          server: toolCall.server,
          result: toolResult,
          success: true
        });
        
        await client.disconnect();
        
        logger.info(`Tool ${toolCall.name} executed successfully`);
        
      } catch (error: any) {
        logger.error(`Error executing tool ${toolCall.name}:`, error);
        results.push({ 
          toolCall: toolCall.name,
          server: toolCall.server,
          error: `Failed to execute ${toolCall.name}: ${error.message}`,
          success: false
        });
      }
    }
    
    return results;
  }

  /**
   * Format final response with tool results
   */
  private async formatFinalResponse(
    originalPrompt: string, 
    toolCalls: ToolCall[], 
    toolResults: Record<string, any>[]
  ): Promise<string> {
    const resultSummary = toolResults.map((result, index) => {
      const toolCall = toolCalls[index];
      if (result.error) {
        return `❌ ${toolCall.name}: ${result.error}`;
      } else {
        return `✅ ${toolCall.name}: ${result.result || 'Executed successfully'}`;
      }
    }).join('\n');
    
    return `I executed the following tools for you:

${resultSummary}

${toolResults.length > 0 ? 'The operations have been completed!' : 'Let me know if you need anything else!'}`;
  }
}