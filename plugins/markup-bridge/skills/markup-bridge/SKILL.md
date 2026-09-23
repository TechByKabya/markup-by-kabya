---
name: markup-bridge
description: Zero-tool-call autonomous pair programming workflow for UI visual feedback submitted live from the web browser via Markup Bridge. Antigravity auto-executes changes when fresh feedback arrives — no user prompting needed.
---

# Markup Bridge: Autonomous UI Feedback Workflow (v2)

> **Performance First**: This skill is designed to implement UI changes in the fewest possible tool calls. Read this fully before acting.

---

## When This Skill Activates

This skill activates when you receive an **autoMessage** or **ephemeralMessage** containing:
- `🎯 New UI feedback from browser` — fresh feedback, auto-execute immediately
- `⏳ older pending UI feedback` — stale feedback, wait for user to confirm

---

## Execution Strategy (Choose Based on Situation)

### ✅ Case 1: ActionCommand is Complete (file path present)

If the autoMessage contains `File: \`path/to/file.tsx\`` — you have everything you need.

**Do this:**
1. **Open the file** at the specified path and line number
2. **Apply the change** described in the action command
3. Call `resolve_ui_feedback`:
   ```json
   {
     "id": "<feedback_id>",
     "resolutionNotes": "Brief summary of what you changed",
     "status": "resolved"
   }
   ```

**Do NOT call** `list_ui_feedback` or `get_ui_feedback` — the action command already contains all required context.

**Total tool calls: 1** (just `resolve_ui_feedback` after editing the file)

---

### ⚠️ Case 2: ActionCommand Lacks a File Path

If the action command does NOT have a `File:` line (e.g., it's a plain HTML/CSS project or the React source map wasn't captured):

1. Use the **CSS Selector** in the action command to search the codebase:
   ```
   grep -r "selector-value" src/
   ```
2. Find the matching file, make the change
3. Call `resolve_ui_feedback`

**Do NOT call** `get_ui_feedback` for this — the selector and user notes are already in the action command.

---

### 🔬 Case 3: Freeform Area Marking (Rectangle/Circle/Pin)

If the action command mentions `Add new content in a marked area region`:

1. Call `get_ui_feedback({ id: "<id>" })` — you DO need the full spatial context here
2. Use the `Container element` and `Placement Hint` to find where to insert the new component
3. Create/insert the appropriate HTML/JSX/component
4. Call `resolve_ui_feedback`

**Total tool calls: 2** (get_ui_feedback + resolve_ui_feedback)

---

## Resolving Multiple Items

If multiple action commands are in the autoMessage, process them **sequentially** in the order listed. After each:
- Edit the file
- Call `resolve_ui_feedback` before moving to the next item

This ensures the browser sees real-time resolution toasts as each item completes.

---

## Emergency Fallback: Manual Inspection

Only use these tools if the above cases fail:

| Tool | When to Use |
|---|---|
| `get_action_command` | Quick scan of all pending items without heavy data |
| `list_ui_feedback` | Browse all pending items by status |
| `get_ui_feedback({ id, includeStyles: false })` | Deep context without CSS dump (default) |
| `get_ui_feedback({ id, includeStyles: true })` | When you specifically need computed styles |
| `clear_ui_feedback` | Clean up after resolving a batch |

---

## Token Budget Guidelines

| Action | Approx Token Cost |
|---|---|
| Reading autoMessage ActionCommand | ~50 |
| `get_action_command` tool call | ~100 |
| `get_ui_feedback` (no styles) | ~400 |
| `get_ui_feedback` (with styles) | ~1200 |
| `list_ui_feedback` | ~300 per 10 items |

**Target: implement any simple style/text/layout change in under 500 tokens total.**
