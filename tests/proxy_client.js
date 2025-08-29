const axios = require('axios');

class ProxyClient {
  constructor(proxyUrl = 'http://localhost:8000') {
    this.proxyUrl = proxyUrl;
  }

  async sendRequest(method, params = {}, id = null) {
    const request = {
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: id || `req-${Date.now()}`
    };

    try {
      console.log(`📤 Sending request: ${JSON.stringify(request)}`);
      
      const response = await axios.post(this.proxyUrl, request, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      console.log(`📥 Response: ${JSON.stringify(response.data, null, 2)}`);
      return response.data;
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
      if (error.response) {
        console.log(`   Status: ${error.response.status}`);
        console.log(`   Data: ${JSON.stringify(error.response.data)}`);
      }
      return null;
    }
  }

  async testGitHubTools() {
    console.log('\n🔧 Testing GitHub tools via proxy...');
    return await this.sendRequest('github/tools/list', {});
  }

  async testFilesystemTools() {
    console.log('\n📁 Testing Filesystem tools via proxy...');
    return await this.sendRequest('filesystem/list_allowed_directories', {});
  }

  async testGDriveTools() {
    console.log('\n☁️ Testing Google Drive tools via proxy...');
    return await this.sendRequest('gdrive/tools/list', {});
  }

  async testGetMethods() {
    console.log('\n📋 Testing get_methods aggregation...');
    return await this.sendRequest('get_methods', {});
  }

  async runAllTests() {
    console.log('🚀 Testing MCP Proxy Server Client\n');
    console.log(`Proxy URL: ${this.proxyUrl}`);
    
    await this.testGetMethods();
    await this.testGitHubTools();
    await this.testFilesystemTools();
    await this.testGDriveTools();
    
    console.log('\n✨ All tests completed!');
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const client = new ProxyClient();
  client.runAllTests().catch(error => {
    console.error('Client error:', error);
  });
}

module.exports = ProxyClient;