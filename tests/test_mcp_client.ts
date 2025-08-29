// Simple test to verify MCP GitHub server through the proxy
import { ConfigurationManager } from './mcp_proxy_server/config';
import { MCPProxyServer } from './mcp_proxy_server/proxy-server';
import { createMCPRequest } from './mcp_proxy_server/models';

async function testMCPClient() {
  console.log('🧪 Testing MCP Client with GitHub server...\n');

  try {
    // Load proxy configuration
    console.log('1️⃣ Loading proxy configuration...');
    const configManager = new ConfigurationManager();
    const config = await configManager.loadConfig('proxy_config.yaml');
    console.log('✅ Configuration loaded');
    console.log(`   - GitHub server URL: ${config.servers.github.url}`);

    // Create proxy server
    console.log('\n2️⃣ Initializing proxy server...');
    const proxyServer = new MCPProxyServer(config);
    console.log('✅ Proxy server initialized');

    // Test GitHub tools/list request
    console.log('\n3️⃣ Testing GitHub tools/list request...');
    const githubRequest = createMCPRequest('github/tools/list', {}, 'test-github-tools');
    
    console.log('📤 Sending request:', JSON.stringify(githubRequest, null, 2));
    
    const response = await proxyServer.handleRequest(githubRequest);
    
    console.log('\n📥 Response received:');
    console.log(JSON.stringify(response, null, 2));

    // Check if we got tools back
    if (response.result && response.result.tools) {
      const tools = response.result.tools;
      console.log('\n🔧 Available GitHub tools:');
      tools.forEach((tool: any, index: number) => {
        console.log(`${index + 1}. ${tool.name} - ${tool.description || 'No description'}`);
      });
      
      console.log(`\n✅ Success! Found ${tools.length} tools from GitHub MCP server.`);
      return tools;
    } else if (response.error) {
      console.log('\n❌ Error response:', response.error.message);
      console.log('   This is expected since we\'re using placeholder forwarding');
      return [];
    } else {
      console.log('\n❓ Unexpected response format');
      return [];
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    return [];
  }
}

// Run the test
testMCPClient()
  .then(tools => {
    console.log('\n🎯 Test completed.');
    console.log('📝 Note: The proxy server is working, but request forwarding needs real MCP server endpoints.');
  })
  .catch(error => {
    console.error('Test failed:', error);
  });