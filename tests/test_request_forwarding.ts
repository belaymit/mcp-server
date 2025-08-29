import { RequestForwarder } from './mcp_proxy_server/request-forwarder';
import { createMCPRequest, createMCPResponse } from './mcp_proxy_server/models';
import * as http from 'http';

// Simple mock MCP server for testing
function createMockMCPServer(port: number, responses: any = {}) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const request = JSON.parse(body);
        console.log(`Mock server ${port} received:`, request.method);
        
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        
        // Return mock response based on method
        const mockResponse = responses[request.method] || {
          result: { 
            message: `Mock response from server ${port}`,
            method: request.method,
            timestamp: new Date().toISOString()
          },
          id: request.id,
          jsonrpc: '2.0'
        };
        
        res.writeHead(200);
        res.end(JSON.stringify(mockResponse));
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({
          error: { code: -32700, message: 'Parse error' },
          jsonrpc: '2.0'
        }));
      }
    });
  });
  
  return server;
}

async function testRequestForwarding() {
  console.log('🧪 Testing Request Forwarding...\n');

  // Create mock servers
  const mockServer1 = createMockMCPServer(8001, {
    'github/tools/list': {
      result: { 
        tools: [
          { name: 'create_issue', description: 'Create a GitHub issue' },
          { name: 'list_repos', description: 'List repositories' }
        ]
      },
      jsonrpc: '2.0'
    }
  });

  const mockServer2 = createMockMCPServer(8002, {
    'filesystem/read': {
      result: { 
        content: 'Mock file content',
        path: '/test/file.txt'
      },
      jsonrpc: '2.0'
    }
  });

  try {
    // Start mock servers
    await new Promise<void>((resolve) => {
      mockServer1.listen(8001, () => {
        console.log('✅ Mock GitHub server started on port 8001');
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      mockServer2.listen(8002, () => {
        console.log('✅ Mock Filesystem server started on port 8002');
        resolve();
      });
    });

    console.log();

    // Test request forwarding
    const forwarder = new RequestForwarder();

    // Test 1: Forward to GitHub server
    console.log('1️⃣ Testing GitHub server forwarding...');
    const githubRequest = createMCPRequest('github/tools/list', {}, 'test-github');
    const githubResponse = await forwarder.forwardRequest('http://localhost:8001', githubRequest);
    
    if (githubResponse.result) {
      console.log('✅ GitHub request forwarded successfully');
      console.log(`   - Tools found: ${githubResponse.result.tools?.length || 0}`);
    } else {
      console.log('❌ GitHub request failed:', githubResponse.error);
    }

    // Test 2: Forward to Filesystem server
    console.log('\n2️⃣ Testing Filesystem server forwarding...');
    const fsRequest = createMCPRequest('filesystem/read', { path: '/test/file.txt' }, 'test-fs');
    const fsResponse = await forwarder.forwardRequest('http://localhost:8002', fsRequest);
    
    if (fsResponse.result) {
      console.log('✅ Filesystem request forwarded successfully');
      console.log(`   - Content: ${fsResponse.result.content}`);
    } else {
      console.log('❌ Filesystem request failed:', fsResponse.error);
    }

    // Test 3: Test error handling with non-existent server
    console.log('\n3️⃣ Testing error handling with non-existent server...');
    const errorRequest = createMCPRequest('test/method', {}, 'test-error');
    const errorResponse = await forwarder.forwardRequest('http://localhost:9999', errorRequest);
    
    if (errorResponse.error) {
      console.log('✅ Error handling works correctly');
      console.log(`   - Error code: ${errorResponse.error.code}`);
      console.log(`   - Error message: ${errorResponse.error.message}`);
    } else {
      console.log('❌ Expected error response but got success');
    }

    // Test 4: Health check
    console.log('\n4️⃣ Testing health checks...');
    const healthyServer = await forwarder.checkServerHealth('http://localhost:8001', '/');
    const unhealthyServer = await forwarder.checkServerHealth('http://localhost:9999', '/');
    
    console.log(`✅ Health check results:`);
    console.log(`   - Server 8001: ${healthyServer ? 'HEALTHY' : 'UNHEALTHY'}`);
    console.log(`   - Server 9999: ${unhealthyServer ? 'HEALTHY' : 'UNHEALTHY'}`);

    console.log('\n🎉 Request forwarding tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Clean up servers
    mockServer1.close();
    mockServer2.close();
    console.log('\n🧹 Mock servers stopped');
  }
}

// Run the test
testRequestForwarding();