import { ConfigurationManager, ProxyConfig } from '../config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('ConfigurationManager', () => {
  let configManager: ConfigurationManager;
  let tempDir: string;
  let testConfigPath: string;

  const validConfig = {
    servers: {
      github: {
        name: 'github',
        url: 'http://localhost:8001',
        timeout: 30,
        maxRetries: 3,
        healthCheckPath: '/health'
      },
      filesystem: {
        name: 'filesystem',
        url: 'http://localhost:8002',
        timeout: 15,
        maxRetries: 2,
        healthCheckPath: '/health'
      }
    },
    routing: {
      strategy: 'prefix',
      rules: {
        github: 'github',
        fs: 'filesystem'
      },
      defaultServer: 'filesystem'
    },
    logging: {
      level: 'INFO',
      format: 'json',
      file: 'proxy.log'
    },
    server: {
      port: 8000,
      host: '0.0.0.0'
    },
    llm: {
      provider: 'openai',
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

  beforeEach(async () => {
    configManager = new ConfigurationManager();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
    testConfigPath = path.join(tempDir, 'test-config.yaml');
  });

  afterEach(async () => {
    configManager.stopAllWatchers();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('loadConfig', () => {
    it('should load valid configuration successfully', async () => {
      const yamlContent = `
servers:
  github:
    url: "http://localhost:8001"
    timeout: 30
    maxRetries: 3
    healthCheckPath: "/health"
  filesystem:
    url: "http://localhost:8002"
    timeout: 15
    maxRetries: 2
    healthCheckPath: "/health"

routing:
  strategy: "prefix"
  rules:
    github: "github"
    fs: "filesystem"
  defaultServer: "filesystem"

logging:
  level: "INFO"
  format: "json"
  file: "proxy.log"

server:
  port: 8000
  host: "0.0.0.0"

llm:
  provider: "openai"
  model: "gpt-4"
  temperature: 0.7
  max_tokens: 4000

ui:
  enabled: true
  port: 3000
  theme: "light"
  max_conversation_history: 100
`;

      await fs.writeFile(testConfigPath, yamlContent);
      const config = await configManager.loadConfig(testConfigPath);

      expect(config.servers.github.url).toBe('http://localhost:8001');
      expect(config.routing.strategy).toBe('prefix');
      expect(config.server.port).toBe(8000);
      expect(config.llm.provider).toBe('openai');
      expect(config.ui.enabled).toBe(true);
    });

    it('should throw error for non-existent file', async () => {
      const nonExistentPath = path.join(tempDir, 'non-existent.yaml');
      
      await expect(configManager.loadConfig(nonExistentPath))
        .rejects.toThrow('Configuration file not found');
    });

    it('should throw error for invalid YAML', async () => {
      const invalidYaml = 'invalid: yaml: content: [';
      await fs.writeFile(testConfigPath, invalidYaml);

      await expect(configManager.loadConfig(testConfigPath))
        .rejects.toThrow('Failed to load configuration');
    });

    it('should resolve environment variables', async () => {
      process.env.TEST_API_KEY = 'test-key-123';
      
      const yamlWithEnvVars = `
servers:
  github:
    url: "http://localhost:8001"

routing:
  strategy: "prefix"
  rules: {}

logging:
  level: "INFO"
  format: "json"

server:
  port: 8000
  host: "0.0.0.0"

llm:
  provider: "openai"
  api_key: "\${TEST_API_KEY}"
  model: "gpt-4"
  temperature: 0.7
  max_tokens: 4000

ui:
  enabled: true
  port: 3000
  theme: "light"
  max_conversation_history: 100
`;

      await fs.writeFile(testConfigPath, yamlWithEnvVars);
      const config = await configManager.loadConfig(testConfigPath);

      expect(config.llm.api_key).toBe('test-key-123');
      
      delete process.env.TEST_API_KEY;
    });
  });

  describe('validateConfig', () => {
    it('should validate valid configuration', () => {
      expect(() => configManager.validateConfig(validConfig as ProxyConfig))
        .not.toThrow();
    });

    it('should throw error for empty servers', () => {
      const invalidConfig = {
        ...validConfig,
        servers: {}
      };

      expect(() => configManager.validateConfig(invalidConfig as ProxyConfig))
        .toThrow('At least one server must be configured');
    });

    it('should throw error for invalid routing strategy', () => {
      const invalidConfig = {
        ...validConfig,
        routing: {
          ...validConfig.routing,
          strategy: 'invalid' as any
        }
      };

      expect(() => configManager.validateConfig(invalidConfig as ProxyConfig))
        .toThrow('Routing strategy must be');
    });

    it('should throw error for routing rule referencing non-existent server', () => {
      const invalidConfig = {
        ...validConfig,
        routing: {
          ...validConfig.routing,
          rules: {
            github: 'nonexistent'
          }
        }
      };

      expect(() => configManager.validateConfig(invalidConfig as ProxyConfig))
        .toThrow('references unknown server');
    });

    it('should throw error for invalid logging level', () => {
      const invalidConfig = {
        ...validConfig,
        logging: {
          ...validConfig.logging,
          level: 'INVALID'
        }
      };

      expect(() => configManager.validateConfig(invalidConfig as ProxyConfig))
        .toThrow('Invalid logging level');
    });

    it('should throw error for invalid LLM provider', () => {
      const invalidConfig = {
        ...validConfig,
        llm: {
          ...validConfig.llm,
          provider: 'invalid' as any
        }
      };

      expect(() => configManager.validateConfig(invalidConfig as ProxyConfig))
        .toThrow('Invalid LLM provider');
    });

    it('should throw error for invalid temperature', () => {
      const invalidConfig = {
        ...validConfig,
        llm: {
          ...validConfig.llm,
          temperature: 3.0
        }
      };

      expect(() => configManager.validateConfig(invalidConfig as ProxyConfig))
        .toThrow('temperature must be between 0 and 2');
    });
  });

  describe('watchConfigChanges', () => {
    it('should watch for configuration changes', async () => {
      const yamlContent = `
servers:
  github:
    url: "http://localhost:8001"

routing:
  strategy: "prefix"
  rules: {}

logging:
  level: "INFO"
  format: "json"

server:
  port: 8000
  host: "0.0.0.0"

llm:
  provider: "openai"
  model: "gpt-4"
  temperature: 0.7
  max_tokens: 4000

ui:
  enabled: true
  port: 3000
  theme: "light"
  max_conversation_history: 100
`;

      await fs.writeFile(testConfigPath, yamlContent);

      return new Promise<void>((resolve, reject) => {
        let callbackCalled = false;
        
        configManager.watchConfigChanges(testConfigPath, (config) => {
          if (!callbackCalled) {
            callbackCalled = true;
            expect(config.server.port).toBe(9000);
            configManager.stopWatching(testConfigPath);
            resolve();
          }
        });

        // Modify the config file after a short delay
        setTimeout(async () => {
          try {
            const modifiedContent = yamlContent.replace('port: 8000', 'port: 9000');
            await fs.writeFile(testConfigPath, modifiedContent);
          } catch (error) {
            reject(error);
          }
        }, 100);

        // Timeout after 5 seconds
        setTimeout(() => {
          if (!callbackCalled) {
            configManager.stopWatching(testConfigPath);
            reject(new Error('Config change callback was not called within timeout'));
          }
        }, 5000);
      });
    });

    it('should stop watching when requested', async () => {
      const yamlContent = `
servers:
  github:
    url: "http://localhost:8001"

routing:
  strategy: "prefix"
  rules: {}

logging:
  level: "INFO"
  format: "json"

server:
  port: 8000
  host: "0.0.0.0"

llm:
  provider: "openai"
  model: "gpt-4"
  temperature: 0.7
  max_tokens: 4000

ui:
  enabled: true
  port: 3000
  theme: "light"
  max_conversation_history: 100
`;

      await fs.writeFile(testConfigPath, yamlContent);

      const callback = jest.fn();
      configManager.watchConfigChanges(testConfigPath, callback);
      configManager.stopWatching(testConfigPath);

      // Modify file after stopping watcher
      await fs.writeFile(testConfigPath, yamlContent.replace('port: 8000', 'port: 9000'));

      // Wait a bit and ensure callback wasn't called
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(callback).not.toHaveBeenCalled();
    });
  });
});