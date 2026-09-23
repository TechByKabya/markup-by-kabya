---
name: markup-bridge
description: >-
  Processes and applies visual UI feedback collected from the browser via Markup Bridge.
  Use when the user types /markup, 'apply feedback', 'fix ui', or when pending browser feedback needs execution.
---

# Markup Bridge: Visual UI Feedback Workflow

This skill applies pending visual UI feedback collected from the browser using the Markup Bridge Chrome extension.

## When to Run
- User types `/markup`
- User requests to "apply feedback", "fix UI issues", or "resolve browser notes"
- Pending UI change requests are injected via pre-invocation hook

## Execution Procedure

### Step 1: Discover Pending Feedback
Check the pending queue using the MCP tool:
```json
call_mcp_tool({
  "ServerName": "markup-bridge",
  "ToolName": "get_action_command",
  "Arguments": { "limit": 10 }
})
```
Or call `list_ui_feedback` if you need detailed metadata.

### Step 2: Batch and Apply Code Changes
For each pending item:
1. Identify the target file from the pre-digested `actionCommand` or React component source. If only a CSS selector is provided, locate the corresponding element in the project template/components.
2. Read the file, make the requested change (text, styling, layout, or feature).
3. Ensure no regressions or syntax errors.

### Step 3: Mark Feedback as Resolved
Immediately resolve each item so the browser visual pin turns green and the badge decrements:
```json
call_mcp_tool({
  "ServerName": "markup-bridge",
  "ToolName": "resolve_ui_feedback",
  "Arguments": {
    "id": "<feedback_id>",
    "resolutionNotes": "Brief description of the change applied",
    "status": "resolved"
  }
})
```

### Step 4: Summary for User
Provide a concise summary listing each feedback ID, what file was modified, and clickable links to the modified files.
