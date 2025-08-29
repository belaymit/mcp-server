# Protocol Understanding Document

## MCP (Model Context Protocol) Overview

### Purpose
MCP standardizes how AI agents access external tools and data sources. It acts as a universal adapter, preventing the need for custom code for every tool an agent might use.

### MCP invoke_method Flow
1. **Client Request**: Agent creates MCP request with method name and parameters
2. **Protocol Validation**: Request validated against MCP JSON-RPC 2.0 format
3. **Server Processing**: MCP server receives request and processes the method
4. **Tool Execution**: Server executes the requested operation (e.g., file read, API call)
5. **Response Formation**: Server formats response according to MCP protocol
6. **Client Response**: Agent receives structured response with result or error

```json
Request:
{
  "jsonrpc": "2.0",
  "method": "invoke_method",
  "params": {
    "method": "list_files",
    "path": "/documents"
  },
  "id": "req-123"
}

Response:
{
  "jsonrpc": "2.0",
  "result": {
    "files": ["doc1.txt", "doc2.pdf"]
  },
  "id": "req-123"
}
```

## A2A (Agent-to-Agent) Protocol Overview

### Purpose
A2A enables different AI agents to communicate and collaborate securely. It provides a standard way for agents to discover capabilities and orchestrate complex workflows.

### Key Differences: MCP vs A2A

| Aspect | MCP | A2A |
|--------|-----|-----|
| **Purpose** | Agent ↔ Tool communication | Agent ↔ Agent communication |
| **Scope** | Tool access standardization | Agent collaboration |
| **Transport** | STDIO, HTTP | HTTP, WebSockets, SSE |
| **Discovery** | get_methods | Agent Cards |
| **Security** | Tool-specific auth | OAuth 2.1, mTLS, API keys |
| **Use Case** | "Access GitHub API" | "Coordinate with Task Agent" |

## Target MCP Servers Summary

### 1. GitHub MCP Server (@cyanheads/git-mcp-server)
- **Purpose**: Provides Git repository operations via MCP protocol
- **Key Methods**: git_status, git_commit, git_push, git_pull, git_log
- **Transport**: STDIO mode
- **Authentication**: GitHub Personal Access Token
- **Use Case**: Enable agents to interact with Git repositories

### 2. Filesystem MCP Server (@modelcontextprotocol/server-filesystem)
- **Purpose**: Provides file system operations via MCP protocol
- **Key Methods**: list_directory, read_file, write_file, delete_file
- **Transport**: STDIO mode
- **Configuration**: Requires base directory path
- **Use Case**: Enable agents to read/write local files safely

### 3. Google Drive MCP Server (@isaacphi/mcp-gdrive)
- **Purpose**: Provides Google Drive operations via MCP protocol
- **Key Methods**: list_files, read_file, upload_file, create_folder
- **Transport**: STDIO mode
- **Authentication**: OAuth 2.0 (Client ID, Client Secret)
- **Use Case**: Enable agents to access Google Drive documents

### 4. Atlassian MCP Server (sooperset/mcp-atlassian)
- **Purpose**: Provides JIRA/Confluence operations via MCP protocol
- **Key Methods**: get_issue, create_issue, update_issue, search_issues
- **Transport**: STDIO mode
- **Authentication**: Atlassian API token
- **Use Case**: Enable agents to manage JIRA tickets and Confluence pages

## Protocol Architecture

```
┌─────────────────┐    MCP Protocol    ┌─────────────────┐
│   AI Agent      │ ←──────────────→   │   MCP Server    │
│                 │                    │                 │
│ - Query parsing │                    │ - Tool wrapper  │
│ - Response proc │                    │ - Auth handling │
│ - Error handlng │                    │ - Data format   │
└─────────────────┘                    └─────────────────┘
                                              │
                                              ▼
                                       ┌─────────────────┐
                                       │  External Tool  │
                                       │                 │
                                       │ - GitHub API    │
                                       │ - File System   │
                                       │ - Google Drive  │
                                       │ - JIRA API      │
                                       └─────────────────┘
```

## Key Insights

1. **Standardization**: MCP provides consistent interface across different tools
2. **Transport Flexibility**: Supports both STDIO and HTTP transports
3. **Security**: Each server handles authentication for its specific tool
4. **Composability**: Multiple MCP servers can be combined via proxy
5. **Agent Integration**: Enables agents to use tools without custom integrations

## Next Steps
- Set up and test each MCP server locally
- Build client script to interact with servers
- Implement proxy server for unified access
- Integrate with RAG agent for enhanced capabilities