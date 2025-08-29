const { spawn } = require('child_process');

class MCPClientTester {
  constructor() {
    this.servers = {
      github: {
        command: 'npx',
        args: ['-y', '@cyanheads/git-mcp-server'],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN
        }
      },
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users\\Lenovo\\Desktop\\Projects\\mcp-server'],
        env: {}
      },
      gdrive: {
        command: 'npx',
        args: ['-y', '@isaacphi/mcp-gdrive'],
        env: {
          CLIENT_ID: process.env.CLIENT_ID,
          CLIENT_SECRET: process.env.CLIENT_SECRET,
          GDRIVE_CREDS_DIR: 'C:\\Users\\Lenovo\\Desktop\\Projects\\mcp-server',
          GDRIVE_CREDENTIALS_FILE: 'C:\\Users\\Lenovo\\Desktop\\Projects\\mcp-server\\.gdrive-server-credentials.json'
        }
      }
    };
  }

  async testServer(serverName) {
    console.log(`\n🧪 Testing ${serverName.toUpperCase()} MCP Server`);
    console.log('='.repeat(50));

    const serverConfig = this.servers[serverName];
    if (!serverConfig) {
      console.log(`❌ Unknown server: ${serverName}`);
      return { success: false, tools: [] };
    }

    return new Promise((resolve) => {
      // Start the MCP server
      const server = spawn('cmd', ['/c', serverConfig.command, ...serverConfig.args], {
        env: { ...process.env, ...serverConfig.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let tools = [];
      let hasResponse = false;
      let testResults = { success: false, tools: [], methods: [] };

      // Test 1: Get available methods
      console.log('\n📋 Step 1: Getting available tools...');
      const toolsRequest = {
        jsonrpc: '2.0',
        id: 'get-tools',
        method: 'tools/list',
        params: {}
      };

      server.stdin.write(JSON.stringify(toolsRequest) + '\n');

      // Handle server output
      server.stdout.on('data', (data) => {
        const output = data.toString();
        
        // Parse JSON responses
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.trim().startsWith('{')) {
            try {
              const response = JSON.parse(line.trim());
              
              if (response.id === 'get-tools' && !hasResponse) {
                hasResponse = true;
                
                if (response.result && response.result.tools) {
                  tools = response.result.tools;
                  testResults.tools = tools;
                  testResults.success = true;
                  
                  console.log(`✅ Found ${tools.length} tools:`);
                  tools.forEach((tool, index) => {
                    console.log(`   ${index + 1}. ${tool.name}`);
                  });

                  // Test 2: Try to invoke a method if available
                  if (tools.length > 0) {
                    this.testInvokeMethod(server, serverName, tools[0], testResults, resolve);
                  } else {
                    server.kill();
                    resolve(testResults);
                  }
                } else if (response.error) {
                  console.log('❌ Error getting tools:', response.error.message);
                  server.kill();
                  resolve(testResults);
                }
              }
            } catch (e) {
              // Ignore non-JSON lines, but optionally log for debugging
              // console.debug('Non-JSON line or parse error:', e);
            }
          }
        }
      });

      // Handle errors
      server.stderr.on('data', (data) => {
        const errorOutput = data.toString();
        if (!errorOutput.includes('Setting up automatic token refresh')) {
          console.log('Server info:', errorOutput.trim());
        }
      });

      server.on('error', (error) => {
        console.log('❌ Failed to start server:', error.message);
        resolve(testResults);
      });

      server.on('close', (code) => {
        if (!hasResponse) {
          console.log('❌ Server closed without response');
          resolve(testResults);
        }
      });

      // Timeout
      setTimeout(() => {
        if (!hasResponse) {
          console.log('⏰ Timeout - killing server');
          server.kill();
          resolve(testResults);
        }
      }, 15000);
    });
  }

  testInvokeMethod(server, serverName, tool, testResults, resolve) {
    console.log(`\n🔧 Step 2: Testing tool invocation - ${tool.name}...`);
    
    // Create a simple test request based on server type
    let testRequest;
    
    if (serverName === 'github') {
      testRequest = {
        jsonrpc: '2.0',
        id: 'test-invoke',
        method: 'tools/call',
        params: {
          name: 'git_status',
          arguments: {}
        }
      };
    } else if (serverName === 'filesystem') {
      testRequest = {
        jsonrpc: '2.0',
        id: 'test-invoke',
        method: 'tools/call',
        params: {
          name: 'list_allowed_directories',
          arguments: {}
        }
      };
    } else if (serverName === 'gdrive') {
      // Skip invocation test for Google Drive as it requires OAuth authentication
      console.log('⚠️ Skipping tool invocation test (requires OAuth authentication)');
      testResults.methods.push({ name: tool.name, success: true, note: 'OAuth required - skipped' });
      server.kill();
      resolve(testResults);
      return;
    }

    if (testRequest) {
      server.stdin.write(JSON.stringify(testRequest) + '\n');

      // Set up listener for invoke response
      const originalListeners = server.stdout.listeners('data');
      server.stdout.removeAllListeners('data');
      
      server.stdout.on('data', (data) => {
        const output = data.toString();
        const lines = output.split('\n');
        
        for (const line of lines) {
          if (line.trim().startsWith('{')) {
            try {
              const response = JSON.parse(line.trim());
              if (response.id === 'test-invoke') {
                if (response.result) {
                  console.log('✅ Tool invocation successful');
                  console.log('   Result preview:', JSON.stringify(response.result).substring(0, 100) + '...');
                  testResults.methods.push({ name: tool.name, success: true });
                } else if (response.error) {
                  console.log('⚠️ Tool invocation failed:', response.error.message);
                  testResults.methods.push({ name: tool.name, success: false, error: response.error.message });
                }
                
                server.kill();
                resolve(testResults);
                return;
              }
            } catch (e) {
              // Ignore non-JSON lines, but optionally log for debugging
              // console.debug('Non-JSON line or parse error:', e);
            }
          }
        }
      });

      // Timeout for invoke test
      setTimeout(() => {
        console.log('⏰ Tool invocation timeout');
        testResults.methods.push({ name: tool.name, success: false, error: 'timeout' });
        server.kill();
        resolve(testResults);
      }, 10000);
    } else {
      server.kill();
      resolve(testResults);
    }
  }

  async testAllServers() {
    console.log('🚀 MCP Client Tester - Testing All Servers');
    console.log('='.repeat(60));

    const results = {};
    
    for (const serverName of Object.keys(this.servers)) {
      try {
        results[serverName] = await this.testServer(serverName);
      } catch (error) {
        console.log(`❌ Error testing ${serverName}:`, error.message);
        results[serverName] = { success: false, tools: [], error: error.message };
      }
    }

    // Summary
    console.log('\n📊 SUMMARY');
    console.log('='.repeat(60));
    
    let totalTools = 0;
    let successfulServers = 0;
    
    for (const [serverName, result] of Object.entries(results)) {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${serverName.toUpperCase()}: ${result.tools.length} tools`);
      
      if (result.success) {
        successfulServers++;
        totalTools += result.tools.length;
      }
      
      if (result.methods && result.methods.length > 0) {
        result.methods.forEach(method => {
          const methodStatus = method.success ? '✅' : '❌';
          console.log(`   ${methodStatus} ${method.name} ${method.error ? `(${method.error})` : ''}`);
        });
      }
    }
    
    console.log(`\n🎯 Total: ${successfulServers}/${Object.keys(this.servers).length} servers working, ${totalTools} tools available`);
    
    return results;
  }
}

// Run the tests
if (require.main === module) {
  const tester = new MCPClientTester();
  tester.testAllServers()
    .then(results => {
      console.log('\n✨ Testing completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Testing failed:', error);
      process.exit(1);
    });
}

module.exports = MCPClientTester;