# Task API Specification

## Base URL
`https://api.nexusai.com/v1/tasks`

## Authentication
All requests require an API key in the header:
```
Authorization: Bearer <api_key>
```

## Endpoints

### GET /tasks
List all tasks with optional filtering.

**Parameters:**
- `status` (optional): Filter by task status
- `assignee` (optional): Filter by assignee
- `limit` (optional): Number of results (default: 50)
- `offset` (optional): Pagination offset

**Response:**
```json
{
  "tasks": [
    {
      "id": "task_123",
      "title": "Implement feature X",
      "description": "Detailed description",
      "status": "in_progress",
      "assignee": "dev_a",
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-16T14:30:00Z"
    }
  ],
  "total": 150,
  "has_more": true
}
```

### GET /tasks/{id}
Get a specific task by ID.

**Response:**
```json
{
  "id": "task_123",
  "title": "Implement feature X",
  "description": "Detailed description",
  "status": "in_progress",
  "assignee": "dev_a",
  "priority": "high",
  "labels": ["backend", "api"],
  "created_at": "2024-01-15T10:00:00Z",
  "updated_at": "2024-01-16T14:30:00Z"
}
```

### POST /tasks
Create a new task.

**Request Body:**
```json
{
  "title": "Task title",
  "description": "Task description",
  "assignee": "dev_a",
  "priority": "medium",
  "labels": ["frontend"]
}
```

## Error Responses
- `400 Bad Request`: Invalid parameters
- `401 Unauthorized`: Invalid or missing API key
- `404 Not Found`: Task not found
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error