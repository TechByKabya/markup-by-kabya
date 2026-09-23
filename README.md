# Markup Bridge for Antigravity IDE

Markup Bridge is the ultimate visual feedback tool for AI-assisted frontend development. 

Instead of typing out long descriptions like *"move the blue button 10px to the left"*, you simply click on the button in your browser, add a visual pin, and the feedback is instantly sent directly into your Antigravity IDE for the AI to fix!

It works on **any website**, **any framework** (React, Vue, HTML), and **any port** without injecting a single line of code into your project files.

## 🚀 Setup Instructions (Just 2 Steps!)

### Step 1: Install the Chrome Extension
1. Download the `markup-bridge-extension.zip` file from the releases.
2. Unzip it to a folder.
3. Open Chrome and navigate to `chrome://extensions`.
4. Turn on **Developer mode** (top right corner).
5. Click **Load unpacked** and select the unzipped folder.

### Step 2: Connect Your Project
Open the project you are working on in your terminal, and run:
```bash
npx markup-by-kabya init
```

**That's it! You are done.** 

When you open your project in the Antigravity IDE, it will automatically detect the configuration, silently launch the bridge in the background, and connect to your Chrome Extension.

## 🎯 How to Use It

1. Open your web app (e.g. `http://localhost:3000`) in Chrome.
2. Click the **Markup Bridge** extension icon in your toolbar and click **Toggle Inspector** (or use the shortcut `Alt + Shift + X`).
3. Click any element on your page (like a button, heading, or card).
4. A comment box will appear. Type your requested changes (e.g., *"Make this text bold and red"*).
5. Click **Submit**.

The AI agent in your Antigravity IDE will immediately receive your feedback, know exactly which file and line of code you are pointing at, and implement the change for you!

## 🛠️ How It Works (For Nerds)

Markup Bridge utilizes the **Model Context Protocol (MCP)**. When you run the `init` command, it generates an `.agents/mcp_config.json` file in your repository.

The Antigravity IDE reads this file and spins up a "Dual Mode" MCP server. This server silently runs a local HTTP bridge (port 3005) in the background that talks to the Chrome Extension, while simultaneously opening an MCP channel to the IDE. This means zero manual server management for you!
