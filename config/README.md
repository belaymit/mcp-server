# MCP Proxy Server Configuration Guide

This directory contains sample configuration files for the MCP Proxy Server. Choose the configuration that best fits your deployment scenario.

## Configuration Files

### `proxy_config.yaml` (Default)
The standard configuration file with prefix-based routing. This is the recommended starting point for most deployments.

**Features:**
- Prefix-based routing (`/github/mcp/...`, `/filesystem/mcp/...`, etc.)
- All four MCP servers configured (GitHub, Filesystem, Google Drive, Atlassian)
- Web UI enabled with OpenAI integration
- Reasonable timeouts and retry settings

### `proxy_config_header_routing.yaml`
Alternative configuration using header-based routing instead of URL prefixes.

**Features:**
- Header-based routing using `X-Target-MCP` header
- Anthropic Claude integration
- Debug logging enabled
- Suitable for API clients that can set custom headers

### `proxy_config_production.yaml`
Production-ready configuration with environment variable support and optimized settings.

**Features:**
- Environment variable substitution for all sensitive values
- Longer timeouts and more retries for reliability
- JSON logging for structured log analysis
- Docker-friendly service URLs
- Comprehensive server aliases

### `proxy_config_local_development.yaml`
Lightweight configuration optimized for local development and testing.

**Features:**
- Short timeouts for fast feedback
- Minimal retries to avoid long waits
- Console logging for immediate visibility
- GPT-3.5 Turbo for cost-effective development

## Configuration Options

### Server Configuration
```yaml
servers:
  server_name:
    url: "http://localhost:8001"      # MCP server URL
    timeout: 30                       # Request timeout in seconds
    maxRetries: 3                     # Number of retry attempts
    healthCheckPath: "/health"        # Health check endpoint
```

### Routing Configuration
```yaml
routing:
  strategy: "prefix"                  # "prefix" or "header"
  rules:
    "github": "github"                # Route key -> server name
    "gh": "github"                    # Aliases supported
  defaultServer: "filesystem"         # Fallback server (optional)
```

**Prefix Routing:**
- Routes based on URL path: `/github/mcp/tools/list`
- First path segment determines the target server

**Header Routing:**
- Routes based on `X-Target-MCP` header value
- Header value must match a routing rule key

### LLM Configuration
```yaml
llm:
  provider: "openai"                  # "openai", "anthropic", "gemini", "local"
  api_key: "${OPENAI_API_KEY}"        # API key (use env vars)
  base_url: "https://api.openai.com/v1"  # Custom endpoint (optional)
  model: "gpt-4"                      # Model name
  temperature: 0.7                    # Generation temperature (0-2)
  max_tokens: 4000                    # Maximum response tokens
```

### Web UI Configuration
```yaml
ui:
  enabled: true                       # Enable/disable web UI
  port: 3000                          # Web UI port
  theme: "light"                      # "light" or "dark"
  max_conversation_history: 100       # Max messages to keep
  allowed_servers: ["github", "fs"]   # Restrict server access (optional)
```

### Logging Configuration
```yaml
logging:
  level: "INFO"                       # DEBUG, INFO, WARNING, ERROR, CRITICAL
  format: "json"                      # "json" or "text"
  file: "proxy.log"                   # Log file path (optional)
```

## Environment Variables

The proxy server supports environment variable substitution in configuration files using the `${VARIABLE_NAME}` syntax.

### Required Environment Variables
- `OPENAI_API_KEY` - OpenAI API key (if using OpenAI)
- `ANTHROPIC_API_KEY` - Anthropic API key (if using Claude)
- `GEMINI_API_KEY` - Google Gemini API key (if using Gemini)

### Optional Environment Variables
- `PROXY_PORT` - Proxy server port (default: 8000)
- `PROXY_HOST` - Proxy server host (default: 0.0.0.0)
- `UI_PORT` - Web UI port (default: 3000)
- `LOG_LEVEL` - Logging level (default: INFO)

See `.env.example` for a complete list of supported environment variables.

## Usage Examples

### Starting with Default Configuration
```bash
# Copy and customize configuration
cp proxy_config.yaml my_config.yaml

# Set environment variables
export OPENAI_API_KEY="your-api-key"

# Start the proxy server
npm run start -- --config my_config.yaml
```

### Using Environment Variables
```bash
# Set all required environment variables
export OPENAI_API_KEY="your-api-key"
export PROXY_PORT=9000
export UI_PORT=3001

# Use production configuration
npm run start -- --config proxy_config_production.yaml
```

### Header-based Routing Example
```bash
# Start with header routing
npm run start -- --config proxy_config_header_routing.yaml

# Make requests with routing header
curl -X POST http://localhost:8000 \
  -H "Content-Type: application/json" \
  -H "X-Target-MCP: github" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": "1"}'
```

## Validation

The proxy server validates all configuration files on startup. Common validation errors:

- **Unknown server reference**: Routing rules must reference configured servers
- **Invalid strategy**: Must be "prefix" or "header"
- **Missing required fields**: URL is required for all servers
- **Invalid timeout values**: Must be positive numbers
- **Invalid LLM provider**: Must be supported provider type

## Security Considerations

1. **API Keys**: Always use environment variables for API keys, never hardcode them
2. **Network Access**: Restrict proxy server access using firewalls or network policies
3. **Logging**: Avoid logging sensitive information in production
4. **HTTPS**: Use HTTPS in production deployments
5. **Authentication**: Consider adding authentication middleware for production use

## Troubleshooting

### Common Issues

**Server Connection Errors:**
- Check that downstream MCP servers are running
- Verify URLs and ports in configuration
- Check network connectivity and firewalls

**Routing Issues:**
- Verify routing rules match request paths/headers
- Check default server configuration
- Enable debug logging to trace routing decisions

**LLM Integration Issues:**
- Verify API keys are set correctly
- Check LLM provider endpoints and models
- Monitor rate limits and quotas

**Web UI Issues:**
- Ensure UI port is not in use by another service
- Check CORS configuration for cross-origin requests
- Verify WebSocket connections for real-time features

### Debug Mode

Enable debug logging for detailed troubleshooting:

```yaml
logging:
  level: "DEBUG"
  format: "text"
```

This will log all routing decisions, request/response details, and error information.