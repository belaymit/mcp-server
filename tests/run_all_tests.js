#!/usr/bin/env node

console.log('🧪 MCP Server Test Suite\n');

const tests = [
  {
    name: 'Individual MCP Servers',
    files: [
      { name: 'GitHub Server', file: 'simple_test.js' },
      { name: 'Filesystem Server', file: 'test_single_server.js' },
      { name: 'Google Drive Server', file: 'test_gdrive_server.js' }
    ]
  },
  {
    name: 'MCP Client Tests',
    files: [
      { name: 'All Servers Client Tester', file: 'mcp_client_tester.js' },
      { name: 'Get Methods & Invoke Test', file: 'test_interaction.js' }
    ]
  },
  {
    name: 'MCP Proxy Server Tests',
    files: [
      { name: 'Proxy Server Unit Tests', file: 'test_proxy_server.js' },
      { name: 'Proxy Client Test', file: 'proxy_client.js' }
    ]
  }
];

console.log('Available Tests:');
console.log('================');

tests.forEach((category, categoryIndex) => {
  console.log(`\n${categoryIndex + 1}. ${category.name}:`);
  category.files.forEach((test, testIndex) => {
    console.log(`   ${categoryIndex + 1}.${testIndex + 1} ${test.name} (${test.file})`);
  });
});

console.log('\nTo run a specific test:');
console.log('  cd tests');
console.log('  node <test_file>');

console.log('\nExample:');
console.log('  node simple_test.js        # Test GitHub server');
console.log('  node mcp_client_tester.js  # Test all MCP servers');
console.log('  node proxy_client.js       # Test proxy server (requires proxy running)');

console.log('\n📝 Test Descriptions:');
console.log('======================');
console.log('• simple_test.js - Tests GitHub MCP server tools');
console.log('• test_single_server.js - Tests Filesystem MCP server tools');
console.log('• test_gdrive_server.js - Tests Google Drive MCP server tools');
console.log('• mcp_client_tester.js - Comprehensive test of all MCP servers');
console.log('• test_interaction.js - Tests get_methods and invoke_method calls');
console.log('• test_proxy_server.js - Unit tests for proxy server components');
console.log('• proxy_client.js - Integration test for running proxy server');