module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/mcp_proxy_server'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'mcp_proxy_server/**/*.ts',
    '!mcp_proxy_server/**/*.test.ts',
    '!mcp_proxy_server/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: 10000,
};