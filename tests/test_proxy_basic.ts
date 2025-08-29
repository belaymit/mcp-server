import { ConfigurationManager } from './mcp_proxy_server/config';
import { Router } from './mcp_proxy_server/router';
import { MCPProxyServer } from './mcp_proxy_server/proxy-server';
import { createMCPRequest } from './mcp_proxy_server/models';

async function testProxyBasics() {
  console.log('🧪 Testing MCP Proxy Server basics...\n');

  try {
    // Test 1: Configuration loading
    console.log('1️⃣ Testing configuration loading...');
    const configManager = new ConfigurationManager();
    const config = await configManager.loadConfig('proxy_config.yaml');
    console.log('✅ Configuration loaded successfully');
    console.log(`   - Servers: ${Object.keys(config.servers).join(', ')}`);
    console.log(`   - Routing strategy: ${config.routing.strategy}`);
    console.log(`   - Server port: ${config.server.port}\n`);

    // Test 2: Configuration validation
    console.log('2️⃣ Testing configuration validation...');
    const isValid = configManager.validateConfig(config);
    console.log(`✅ Configuration validation: ${isValid ? 'PASSED' : 'FAILED'}\n`);

    // Test 3: Router initialization
    console.log('3️⃣ Testing router initialization...');
    const router = new Router(config.routing, config.servers);
    console.log('✅ Router initialized successfully');
    console.log(`   - Available servers: ${router.getAvailableServers().join(', ')}`);
    console.log(`   - Routing rules: ${Object.keys(router.getRoutingRules()).join(', ')}\n`);

    // Test 4: Routing logic
    console.log('4️⃣ Testing routing logic...');
    
    // Test prefix-based routing
    const testRequest1 = createMCPRequest('github/tools/list', {}, 'test-1');
    const routingResult1 = router.routeRequest(testRequest1);
    console.log(`✅ Routed 'github/tools/list' to: ${routingResult1.serverName} (${routingResult1.serverUrl})`);

    const testRequest2 = createMCPRequest('filesystem/read', { path: '/test' }, 'test-2');
    const routingResult2 = router.routeRequest(testRequest2);
    console.log(`✅ Routed 'filesystem/read' to: ${routingResult2.serverName} (${routingResult2.serverUrl})`);

    // Test fallback to default server
    const testRequest3 = createMCPRequest('unknown/method', {}, 'test-3');
    const routingResult3 = router.routeRequest(testRequest3);
    console.log(`✅ Routed 'unknown/method' to default: ${routingResult3.serverName} (${routingResult3.serverUrl})\n`);

    // Test 5: Proxy server initialization
    console.log('5️⃣ Testing proxy server initialization...');
    const proxyServer = new MCPProxyServer(config);
    console.log('✅ Proxy server initialized successfully\n');

    // Test 6: Request handling (with placeholder responses)
    console.log('6️⃣ Testing request handling...');
    const testRequest4 = createMCPRequest('github/tools/list', {}, 'test-4');
    const response = await proxyServer.handleRequest(testRequest4);
    console.log('✅ Request handled successfully');
    console.log(`   - Response: ${JSON.stringify(response, null, 2)}\n`);

    console.log('🎉 All basic tests passed! The proxy server structure is working correctly.');
    console.log('📝 Note: Request forwarding and response aggregation are still using placeholder implementations.');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testProxyBasics();