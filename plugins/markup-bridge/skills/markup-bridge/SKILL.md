---
name: markup-bridge
description: Autonomous pair programming workflow for inspecting and addressing UI visual feedback, element modifications, and freeform area markings submitted live from the web browser via Markup Bridge MCP.
---

# Markup Bridge: Autonomous Visual UI Feedback Workflow

Use this skill whenever the user submits UI modification notes, bug reports, styling requests, or freeform area markings from their live web application via the Markup Bridge.

## 1. Inspecting Feedback

When a notification or turn indicates pending UI feedback:
1. Call `list_ui_feedback({ status: 'pending' })` to view all pending requests.
2. Call `get_ui_feedback({ id: '<feedback_id>' })` to retrieve deep structured context:
   - **Target Element**: Minimal unique CSS selector path.
   - **Framework Context**: React, Vue, Svelte, or Angular component name and source file path (`File.tsx:line`).
   - **Freeform Area Marking**: If the user drew a Rectangle (▢), Circle (◯), or Pin (📍), inspect the `Dimensions`, `Nearest Container Element`, and `Spatial Placement Hint`.
   - **Computed Styles**: Display, flex/grid, colors, padding, margins, font sizes.
   - **User Notes**: Exactly what the user requested to change or add.

## 2. Implementing Changes

1. Locate the component file using the framework source path (e.g. `src/components/Navbar.tsx`) or search for the CSS selector / HTML snippet.
2. If it's a **Freeform Area Marking** (e.g., "add testimonials here" in an empty space), insert the new component or HTML in the container at the specified relative position.
3. If it's an **Element Modification** (e.g., "change button color to emerald green"), update the styles, classes, or JSX/HTML markup.

## 3. Resolving and Notifying the Browser

Once the code changes are made:
1. Call `resolve_ui_feedback`:
   ```json
   {
     "id": "<feedback_id>",
     "resolutionNotes": "Summary of changes made to the component or styles",
     "status": "resolved"
   }
   ```
2. The bridge server immediately dispatches a real-time Server-Sent Event (SSE) to the user's active browser session, displaying an interactive resolution toast and turning their marker pin green.
