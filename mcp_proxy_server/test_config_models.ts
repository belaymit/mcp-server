import { ConfigurationManager } from "./config";
import { createChatMessage, createToolCall, createServerStatus } from "./models";

async function testConfigurationModels() {
  console.log("Testing configuration models...");
  
  const configManager = new ConfigurationManager();
  
  try {
    // Test loading the configuration
    const config = await configManager.loadConfig("proxy_config.yaml");
    
    console.log("✅ Configuration loaded successfully");
    console.log("Servers:", Object.keys(config.servers));
    console.log("Routing strategy:", config.routing.strategy);
    console.log("LLM provider:", config.llm.provider);
    console.log("LLM model:", config.llm.model);
    console.log("UI enabled:", config.ui.enabled);
    console.log("UI port:", config.ui.port);
    console.log("UI allowed servers:", config.ui.allowed_servers);
    
    // Test validation
    configManager.validateConfig(config);
    console.log("✅ Configuration validation passed");
    
    // Test web UI models
    const chatMessage = createChatMessage("Hello, world!", "user");
    console.log("✅ Chat message created:", chatMessage.id);
    
    const toolCall = createToolCall("list_files", "filesystem", { path: "/" });
    console.log("✅ Tool call created:", toolCall.id);
    
    const serverStatus = createServerStatus("github", "http://localhost:8001", "online", ["create_issue", "list_repos"]);
    console.log("✅ Server status created:", serverStatus.name);
    
    console.log("\n🎉 All configuration models working correctly!");
    
  } catch (error) {
    console.error("❌ Configuration test failed:", error);
    process.exit(1);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testConfigurationModels();
}

export { testConfigurationModels };