# Fix for NEX-456: MCP Server Implementation for Task API
import asyncio
from typing import Dict, Any

class TaskMCPServer:
    """MCP Server wrapper for Task Management API"""
    
    def __init__(self, task_api_client):
        self.task_api = task_api_client
    
    async def get_methods(self) -> Dict[str, Any]:
        """Return available MCP methods"""
        return {
            "methods": [
                {"name": "list_tasks", "description": "List all tasks"},
                {"name": "get_task", "description": "Get task by ID"},
                {"name": "create_task", "description": "Create new task"},
                {"name": "update_task", "description": "Update existing task"}
            ]
        }
    
    async def invoke_method(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle MCP method invocation"""
        if method == "list_tasks":
            return await self.task_api.list_tasks()
        elif method == "get_task":
            return await self.task_api.get_task(params.get("task_id"))
        # ... other methods