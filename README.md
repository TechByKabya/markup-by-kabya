# Markup Bridge

A bidirectional UI visual feedback and inspection bridge designed to connect web applications directly to the Antigravity system via the Model Context Protocol (MCP).

Markup Bridge injects a production-grade shadow DOM visual inspector into any web environment, allowing developers and QA engineers to select DOM elements, draw area markers, and submit structured feedback. This feedback is securely transmitted via an active MCP server directly into your local Antigravity AI agent context.

## Architecture

Markup Bridge consists of three core components:

1. **Client Injector (Chrome Extension or Script Tag)**
   - Injects an encapsulated shadow DOM UI overlay into the host page.
   - Handles pointer events, element picking, computed style extraction, React Fiber state extraction, and screenshot capturing.
   - Communicates with the daemon via Server-Sent Events (SSE) and HTTP POST.

2. **Bridge Daemon (Node.js)**
   - A lightweight HTTP/SSE server running locally on port 3005.
   - Receives structured feedback payloads from the client UI.
   - Manages a persistent queue of feedback events written to disk.

3. **MCP Integration**
   - Implements the standard Model Context Protocol via Stdio.
   - Exposes tools for the Antigravity agent to query, list, and resolve the feedback queue natively.

## Prerequisites

Before running Markup Bridge, you must have the following installed on your machine:
- **Node.js** (v18 or higher recommended) - [Download Here](https://nodejs.org/)

Because the tool uses `npx`, Node.js is required to automatically fetch and execute the bridge server from the global NPM registry.

## Installation

To initialize the daemon and install the necessary MCP configurations into your Antigravity workspace, run the following command in the root of your project:

```bash
npx markup-bridge
```

This command will:
- Spin up the local HTTP/SSE bridge daemon.
- Automatically register the Markup Bridge MCP server into your `.agents/mcp_config.json` file.

### Chrome Extension Installation

For the best developer experience, use the Markup Bridge Chrome Extension to inject the client UI across any local or remote web application:

1. Navigate to `chrome://extensions` in your Google Chrome browser.
2. Enable **Developer Mode**.
3. Select **Load unpacked**.
4. Select the `extension/` directory located within this repository.
5. Click the Markup Bridge extension icon in your toolbar to toggle the inspector on your active tab.

## Usage

### Providing Feedback
Once the extension is active on a web page, you can interact with the DOM using the following modes:
- **Element Inspection:** Hover and click on any specific DOM node to capture its outer HTML, computed CSS styles, and React Fiber context.
- **Area Selection:** Draw rectangles or drop coordinate pins to annotate spatial areas.
- **Payload Submission:** Add structured notes, assign tags (e.g., Bug, Styling, Feature), and submit. The payload is instantly relayed to the local daemon.

### Antigravity AI Context
When feedback is submitted, your Antigravity AI agent can natively read and act on the feedback queue. The agent receives a comprehensive context payload containing:
- Target Element Selector
- Full URL and Page Context (Path, Search queries, Viewport)
- Extracted CSS Computed Styles
- React Component State
- Base64 Screenshot Snippets
- User Annotations

## License
MIT License. See LICENSE for more information.
