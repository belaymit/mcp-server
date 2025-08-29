# Agent-to-Agent (A2A) Protocol Specification

## Overview
The A2A protocol enables secure communication between AI agents in a distributed system.

## Core Concepts

### Agent Cards
Each agent publishes an "Agent Card" describing its capabilities:
```json
{
  "agent_id": "task-manager-agent",
  "name": "Task Management Agent",
  "version": "1.0.0",
  "capabilities": [
    "task_creation",
    "task_assignment",
    "status_tracking"
  ],
  "endpoints": {
    "http": "https://agents.nexusai.com/task-manager",
    "websocket": "wss://agents.nexusai.com/task-manager/ws"
  },
  "authentication": {
    "type": "oauth2",
    "scopes": ["tasks:read", "tasks:write"]
  }
}
```

### Message Format
A2A uses JSON-RPC 2.0 for request/response:
```json
{
  "jsonrpc": "2.0",
  "method": "agent.invoke",
  "params": {
    "capability": "task_creation",
    "data": {
      "title": "New task",
      "assignee": "dev_a"
    }
  },
  "id": "req-123"
}
```

### Security Models

#### OAuth 2.1 + OpenID Connect
- **Authorization Server**: Central auth service
- **Client Credentials Flow**: For agent-to-agent communication
- **Scopes**: Fine-grained permissions
- **JWT Tokens**: Stateless authentication

#### Mutual TLS (mTLS)
- **Certificate-based authentication**
- **Client and server certificates**
- **Certificate rotation policies**
- **Certificate Authority (CA) management**

#### API Keys with HMAC
- **Shared secret approach**
- **Request signing with HMAC-SHA256**
- **Timestamp validation**
- **Replay attack prevention**

## Transport Mechanisms

### HTTP/HTTPS
- RESTful endpoints
- Request/response pattern
- Suitable for synchronous operations

### WebSockets
- Real-time bidirectional communication
- Event streaming
- Connection persistence

### Server-Sent Events (SSE)
- Unidirectional server-to-client streaming
- Event-based updates
- Automatic reconnection

## Implementation Recommendations
1. Use OAuth 2.1 for production environments
2. Implement proper rate limiting
3. Add comprehensive audit logging
4. Support graceful degradation
5. Include health check endpoints