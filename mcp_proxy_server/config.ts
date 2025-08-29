import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as yaml from "yaml";
import { createLogger } from "./logger";

const logger = createLogger("config");

export interface ServerConfig {
  name: string;
  url: string;
  timeout?: number;
  maxRetries?: number;
  healthCheckPath?: string;
}

export interface RoutingConfig {
  strategy: "prefix" | "header";
  rules: Record<string, string>;
  defaultServer?: string;
}

export interface LoggingConfig {
  level: string;
  format: string;
  file?: string;
}

export interface ServerSettings {
  port: number;
  host: string;
}

export interface LLMConfig {
  provider: "openai" | "anthropic" | "gemini" | "local";
  api_key?: string;
  base_url?: string;
  model: string;
  temperature: number;
  max_tokens: number;
}

export interface UIConfig {
  enabled: boolean;
  port: number;
  theme: string;
  max_conversation_history: number;
  allowed_servers?: string[];
}

export interface ProxyConfig {
  servers: Record<string, ServerConfig>;
  routing: RoutingConfig;
  logging: LoggingConfig;
  server: ServerSettings;
  llm: LLMConfig;
  ui: UIConfig;
}

export class ConfigurationManager {
  private watchers: Map<string, fsSync.FSWatcher> = new Map();

  async loadConfig(configPath: string): Promise<ProxyConfig> {
    try {
      const configContent = await fs.readFile(configPath, "utf-8");
      const rawConfig = yaml.parse(configContent);
      const config = this.parseConfig(rawConfig);

      logger.info(`Configuration loaded successfully from ${configPath}`);
      return config;
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        throw new Error(`Configuration file not found: ${configPath}`);
      }
      throw new Error(`Failed to load configuration: ${error}`);
    }
  }

  /**
   * Watch configuration file for changes and reload automatically.
   */
  watchConfigChanges(
    configPath: string,
    callback: (config: ProxyConfig) => void
  ): void {
    // Stop existing watcher if any
    this.stopWatching(configPath);

    try {
      const watcher = fsSync.watch(configPath, async (eventType) => {
        if (eventType === "change") {
          try {
            logger.info(
              `Configuration file changed: ${configPath}, reloading...`
            );
            const newConfig = await this.loadConfig(configPath);
            this.validateConfig(newConfig);
            callback(newConfig);
            logger.info("Configuration reloaded successfully");
          } catch (error) {
            logger.error(`Failed to reload configuration: ${error}`);
          }
        }
      });

      this.watchers.set(configPath, watcher);
      logger.info(`Started watching configuration file: ${configPath}`);
    } catch (error) {
      logger.error(`Failed to watch configuration file: ${error}`);
      throw error;
    }
  }

  /**
   * Stop watching a configuration file.
   */
  stopWatching(configPath: string): void {
    const watcher = this.watchers.get(configPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(configPath);
      logger.info(`Stopped watching configuration file: ${configPath}`);
    }
  }

  /**
   * Stop all configuration file watchers.
   */
  stopAllWatchers(): void {
    for (const [path, watcher] of this.watchers) {
      watcher.close();
      logger.info(`Stopped watching configuration file: ${path}`);
    }
    this.watchers.clear();
  }

  /**
   * Resolve environment variables in configuration values
   */
  private resolveEnvironmentVariables(value: any): any {
    if (typeof value === 'string') {
      // Replace ${VAR_NAME} with environment variable value
      return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
        return process.env[varName] || match;
      });
    }
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return value.map(item => this.resolveEnvironmentVariables(item));
      } else {
        const resolved: any = {};
        for (const [key, val] of Object.entries(value)) {
          resolved[key] = this.resolveEnvironmentVariables(val);
        }
        return resolved;
      }
    }
    return value;
  }

  /**
   * Parse raw configuration object into ProxyConfig.
   */
  private parseConfig(rawConfig: any): ProxyConfig {
    try {
      // Resolve environment variables in the entire config
      const resolvedConfig = this.resolveEnvironmentVariables(rawConfig);

      // Parse servers
      const servers: Record<string, ServerConfig> = {};
      const serversData = resolvedConfig.servers || {};

      for (const [name, serverData] of Object.entries(serversData)) {
        const server = serverData as any;
        servers[name] = {
          name,
          url: server.url,
          timeout: server.timeout || 30,
          maxRetries: server.maxRetries || 3,
          healthCheckPath: server.healthCheckPath || "/health",
        };
      }

      // Parse routing
      const routingData = resolvedConfig.routing || {};
      const routing: RoutingConfig = {
        strategy: routingData.strategy || "prefix",
        rules: routingData.rules || {},
        defaultServer: routingData.defaultServer,
      };

      // Parse logging
      const loggingData = resolvedConfig.logging || {};
      const logging: LoggingConfig = {
        level: loggingData.level || "INFO",
        format: loggingData.format || "json",
        file: loggingData.file,
      };

      // Parse server settings
      const serverData = resolvedConfig.server || {};
      const server: ServerSettings = {
        port: serverData.port || 8000,
        host: serverData.host || "0.0.0.0",
      };

      // Parse LLM configuration
      const llmData = resolvedConfig.llm || {};
      const llm: LLMConfig = {
        provider: llmData.provider || "openai",
        api_key: llmData.api_key,
        base_url: llmData.base_url,
        model: llmData.model || "gpt-4",
        temperature: llmData.temperature || 0.7,
        max_tokens: llmData.max_tokens || 4000,
      };

      // Parse UI configuration
      const uiData = resolvedConfig.ui || {};
      const ui: UIConfig = {
        enabled: uiData.enabled !== false, // Default to true
        port: uiData.port || 3000,
        theme: uiData.theme || "light",
        max_conversation_history: uiData.max_conversation_history || 100,
        allowed_servers: uiData.allowed_servers,
      };

      return {
        servers,
        routing,
        logging,
        server,
        llm,
        ui,
      };
    } catch (error) {
      throw new Error(`Invalid configuration: ${error}`);
    }
  }

  /**
   * Validate the configuration.
   */
  validateConfig(config: ProxyConfig): boolean {
    // Validate servers
    if (Object.keys(config.servers).length === 0) {
      throw new Error("At least one server must be configured");
    }

    // Validate routing strategy
    if (!["prefix", "header"].includes(config.routing.strategy)) {
      throw new Error("Routing strategy must be 'prefix' or 'header'");
    }

    // Validate routing rules reference existing servers
    for (const [ruleKey, serverName] of Object.entries(config.routing.rules)) {
      if (!(serverName in config.servers)) {
        throw new Error(
          `Routing rule '${ruleKey}' references unknown server '${serverName}'`
        );
      }
    }

    // Validate default server if specified
    if (
      config.routing.defaultServer &&
      !(config.routing.defaultServer in config.servers)
    ) {
      throw new Error(
        `Default server '${config.routing.defaultServer}' not found in servers`
      );
    }

    // Validate logging level
    const validLevels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];
    if (!validLevels.includes(config.logging.level)) {
      throw new Error(`Invalid logging level: ${config.logging.level}`);
    }

    // Validate LLM configuration
    const validProviders = ["openai", "anthropic", "gemini", "local"];
    if (!validProviders.includes(config.llm.provider)) {
      throw new Error(`Invalid LLM provider: ${config.llm.provider}`);
    }

    if (config.llm.temperature < 0 || config.llm.temperature > 2) {
      throw new Error("LLM temperature must be between 0 and 2");
    }

    if (config.llm.max_tokens <= 0) {
      throw new Error("LLM max_tokens must be greater than 0");
    }

    // Validate UI configuration
    if (config.ui.port <= 0 || config.ui.port > 65535) {
      throw new Error("UI port must be between 1 and 65535");
    }

    if (config.ui.max_conversation_history <= 0) {
      throw new Error("UI max_conversation_history must be greater than 0");
    }

    // Validate allowed_servers if specified
    if (config.ui.allowed_servers) {
      for (const serverName of config.ui.allowed_servers) {
        if (!(serverName in config.servers)) {
          throw new Error(
            `UI allowed_servers references unknown server '${serverName}'`
          );
        }
      }
    }

    logger.info("Configuration validation passed");
    return true;
  }
}
