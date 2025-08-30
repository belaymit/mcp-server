import { ConfigurationManager, ProxyConfig } from "./config";

async function testConfigurationLoading() {
  const configManager = new ConfigurationManager();

  try {
    const config = await configManager.loadConfig("../proxy_config.yaml");
    const isValid = configManager.validateConfig(config);
    return isValid;
  } catch (error) {
    return false;
  }
}

async function testConfigurationValidationErrors() {
  const configManager = new ConfigurationManager();

  // Test 1: Empty servers
  try {
    const invalidConfig: ProxyConfig = {
      servers: {},
      routing: { strategy: "prefix", rules: {} },
      logging: { level: "INFO", format: "json" },
      server: { port: 8000, host: "0.0.0.0" },
      llm: { provider: "openai", model: "gpt-4", temperature: 0.7, max_tokens: 4000 },
      ui: { enabled: true, port: 3000, theme: "light", max_conversation_history: 100 }
    };
    configManager.validateConfig(invalidConfig);
    return false;
  } catch (error) {
    // Expected error
  }

  // Test 2: Invalid routing strategy
  try {
    const invalidConfig: ProxyConfig = {
      servers: { test: { name: "test", url: "http://localhost:8001" } },
      routing: { strategy: "invalid" as any, rules: {} },
      logging: { level: "INFO", format: "json" },
      server: { port: 8000, host: "0.0.0.0" },
      llm: { provider: "openai", model: "gpt-4", temperature: 0.7, max_tokens: 4000 },
      ui: { enabled: true, port: 3000, theme: "light", max_conversation_history: 100 }
    };
    configManager.validateConfig(invalidConfig);
    return false;
  } catch (error) {
    // Expected error
  }

  // Test 3: Routing rule references non-existent server
  try {
    const invalidConfig: ProxyConfig = {
      servers: { test: { name: "test", url: "http://localhost:8001" } },
      routing: { strategy: "prefix", rules: { github: "nonexistent" } },
      logging: { level: "INFO", format: "json" },
      server: { port: 8000, host: "0.0.0.0" },
      llm: { provider: "openai", model: "gpt-4", temperature: 0.7, max_tokens: 4000 },
      ui: { enabled: true, port: 3000, theme: "light", max_conversation_history: 100 }
    };
    configManager.validateConfig(invalidConfig);
    return false;
  } catch (error) {
    // Expected error
  }

  return true;
}

async function main() {
  const result1 = await testConfigurationLoading();
  const result2 = await testConfigurationValidationErrors();

  const success = result1 && result2;
  return success;
}

// Run tests if this script is executed directly
if (require.main === module) {
  main().catch(console.error);
}
