/**
 * Antigravity UI Visual Feedback Bridge - Browser Client
 * Self-contained injectable script with Shadow DOM encapsulation.
 * Supports:
 * - 🎯 DOM Element Inspect (hover, highlight, freeze, React Fiber context)
 * - ▢ Rectangle Area Marking (click & drag to mark empty space or regions)
 * - ◯ Circle Area Marking (click & drag circular regions anywhere)
 * - 📍 Point Pin Marking (click anywhere to drop a feedback pin)
 * - Real-time bidirectional SSE integration with Antigravity
 */

window.__INIT_MARKUP_BRIDGE__ = function () {
  if (window.__ANTIGRAVITY_BRIDGE_INITIALIZED__) {
    return;
  }
  window.__ANTIGRAVITY_BRIDGE_INITIALIZED__ = true;

  // Port is injected by Chrome extension (content.js sets window.__MARKUP_BRIDGE_PORT__)
  // Fallback to 3005 for direct script-tag usage
  const _port = (window.__MARKUP_BRIDGE_PORT__ && Number.isInteger(window.__MARKUP_BRIDGE_PORT__))
    ? window.__MARKUP_BRIDGE_PORT__
    : 3005;
  const BRIDGE_API_BASE = `http://127.0.0.1:${_port}`;
  let isActive = false;
  let currentMode = 'inspect'; // 'inspect' | 'rect' | 'circle' | 'pin'
  let isDrawing = false;
  let startX = 0;
  let startY = 0;
  let hoveredElement = null;
  let selectedElement = null;
  let currentAreaMarking = null;
  let isModalOpen = false;
  let sseConnection = null;
  let pendingCount = 0;
  let markers = [];

  // ==========================================
  // Shadow DOM Host & Style Setup
  // ==========================================
  const host = document.createElement('div');
  host.id = 'antigravity-bridge-host';
  host.setAttribute('data-ag-internal', 'true');
  const shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      color: #e2e8f0;
      z-index: 2147483647;
      position: static;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }



    /* Reset & Base within Shadow Root */
    :host {
      all: initial;
    }
    * {
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    /* Floating Pill */
    .ag-pill {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 9999px;
      padding: 8px 12px 8px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.1);
      cursor: pointer;
      z-index: 2147483647;
      color: #111827;
      font-size: 13px;
      user-select: none;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    
    .ag-pill:hover {
      box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.12);
      transform: translateY(-1px);
    }

    .ag-pill-status {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #34c759;
      box-shadow: 0 0 6px rgba(52, 199, 89, 0.5);
      transition: background 0.3s;
    }

    .ag-pill-status.disconnected {
      background: #ff3b30;
      box-shadow: 0 0 6px rgba(255, 59, 48, 0.5);
    }

    .ag-pill.active .ag-pill-status {
      background: #007aff;
      box-shadow: 0 0 8px rgba(0, 122, 255, 0.6);
      animation: ag-pulse 1.5s infinite;
    }

    @keyframes ag-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.2); }
    }

    .ag-pill-label {
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .ag-pill-badge {
      background: #007aff;
      color: #fff;
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 9999px;
      min-width: 18px;
      text-align: center;
    }

    .ag-pill-shortcut {
      color: #6b7280;
      font-size: 11px;
      padding-left: 4px;
      border-left: 1px solid rgba(0, 0, 0, 0.1);
    }

    .ag-pill-close {
      margin-left: 6px;
      margin-right: -4px;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      font-size: 14px;
      color: #9ca3af;
      transition: all 0.15s;
    }
    .ag-pill-close:hover {
      background: #ff3b30;
      color: #fff;
    }

    /* Mode Toolbar */
    .ag-toolbar {
      position: fixed;
      bottom: 74px;
      right: 24px;
      display: none;
      align-items: center;
      gap: 4px;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 10px;
      padding: 4px;
      box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.15);
      z-index: 2147483647;
      animation: ag-fade-up 0.2s ease-out;
    }

    .ag-toolbar.visible {
      display: flex;
    }

    @keyframes ag-fade-up {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .ag-tool-btn {
      background: transparent;
      border: 1px solid transparent;
      color: #6b7280;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s;
    }

    .ag-tool-btn:hover {
      color: #111827;
      background: rgba(0, 0, 0, 0.05);
    }

    .ag-tool-btn.active {
      background: #007aff;
      color: #fff;
      border-color: #007aff;
      box-shadow: 0 2px 8px rgba(0, 122, 255, 0.3);
    }

    /* Full-Screen Drawing Layer */
    .ag-draw-canvas {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483644;
      pointer-events: none;
    }

    .ag-draw-canvas.drawing-active {
      pointer-events: auto;
      cursor: crosshair;
    }

    .ag-shape-preview {
      stroke: #007aff;
      stroke-width: 2;
      stroke-dasharray: 6 3;
      fill: rgba(0, 122, 255, 0.1);
      filter: drop-shadow(0 0 4px rgba(0, 122, 255, 0.3));
    }

    .ag-draw-dims {
      position: fixed;
      pointer-events: none;
      background: #007aff;
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      z-index: 2147483645;
      display: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.15);
    }

    /* Inspector Highlight Box */
    .ag-highlight-box {
      position: fixed;
      pointer-events: none;
      border: 2px solid #007aff;
      background: rgba(0, 122, 255, 0.08);
      border-radius: 3px;
      z-index: 2147483645;
      transition: all 0.08s ease-out;
      display: none;
      box-shadow: 0 0 8px rgba(0, 122, 255, 0.25);
    }

    .ag-highlight-tag {
      position: absolute;
      top: -26px;
      left: -2px;
      background: #007aff;
      color: #ffffff;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 4px 4px 0 0;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }

    .ag-highlight-tag .ag-react-badge {
      background: #5856d6;
      color: #fff;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 600;
      font-size: 10px;
    }

    .ag-highlight-tag .ag-dims {
      color: rgba(255, 255, 255, 0.8);
      font-size: 10px;
      font-weight: 400;
    }

    /* Persistent Markers Layer */
    .ag-markers-layer {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483643;
    }

    .ag-marker-pin {
      position: absolute;
      pointer-events: auto;
      transform: translate(-50%, -100%);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .ag-marker-pin:hover {
      transform: translate(-50%, -105%) scale(1.1);
    }

    .ag-marker-badge {
      background: #007aff;
      color: #fff;
      font-weight: 600;
      font-size: 11px;
      padding: 4px 8px;
      border-radius: 9999px;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
      display: flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }

    .ag-marker-badge.resolved {
      background: #34c759;
    }

    .ag-marker-shape {
      position: absolute;
      pointer-events: none;
      border: 2px dashed #007aff;
      background: rgba(0, 122, 255, 0.05);
      border-radius: 8px;
    }

    .ag-marker-shape.circle {
      border-radius: 50%;
    }

    .ag-marker-shape.resolved {
      border-color: #34c759;
      background: rgba(52, 199, 89, 0.05);
    }

    /* Modal Overlay */
    .ag-modal-backdrop {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.4);
      backdrop-filter: blur(8px);
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .ag-modal-backdrop.open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
    }

    .ag-modal {
      background: #ffffff;
      width: 90%;
      max-width: 680px;
      max-height: 90vh;
      border-radius: 20px;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0,0,0,0.04);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform: scale(0.96) translateY(10px);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .ag-modal-backdrop.open .ag-modal {
      background: #ffffff;
      width: 90%;
      max-width: 680px;
      max-height: 90vh;
      border-radius: 20px;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0,0,0,0.04);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform: scale(0.96) translateY(10px);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .ag-modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(255, 255, 255, 0.8);
    }

    .ag-modal-title {
      font-size: 18px;
      font-weight: 600;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 10px;
      letter-spacing: -0.3px;
    }

    .ag-modal-close {
      background: transparent;
      border: none;
      color: #6b7280;
      cursor: pointer;
      font-size: 18px;
      padding: 4px 8px;
      border-radius: 6px;
      transition: all 0.2s;
    }

    .ag-modal-close:hover {
      background: rgba(0, 0, 0, 0.05);
      color: #111827;
    }

    .ag-modal-body {
      padding: 16px 24px;
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      gap: 16px;
      overflow-y: auto;
    }

    .ag-element-card {
      background: #f8fafc;
      border: 1px solid rgba(0, 0, 0, 0.04);
      border-radius: 12px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.01);
    }

    .ag-selector-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .ag-selector-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      color: #0369a1;
      background: #f0f9ff;
      padding: 4px 6px;
      border-radius: 6px;
      overflow-x: auto;
      white-space: nowrap;
      flex: 1;
      border: 1px solid rgba(3, 105, 161, 0.1);
    }

    .ag-area-spatial-hint {
      font-size: 12px;
      color: #475569;
      background: #f8fafc;
      border: 1px solid rgba(0, 0, 0, 0.06);
      border-radius: 6px;
      padding: 8px 10px;
      line-height: 1.4;
    }

    .ag-react-info {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #7e22ce;
    }

    .ag-react-badge-lg {
      background: #f3e8ff;
      color: #6b21a8;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      border: 1px solid rgba(107, 33, 168, 0.1);
    }

    .ag-source-location {
      font-size: 11px;
      color: #64748b;
      font-family: monospace;
    }

    /* Computed Styles Grid */
    .ag-styles-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      background: #ffffff;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(0, 0, 0, 0.05);
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      box-shadow: 0 1px 3px rgba(0,0,0,0.02);
    }

    .ag-style-item {
      display: flex;
      justify-content: space-between;
      color: #64748b;
    }

    .ag-style-item span:last-child {
      color: #0f172a;
      font-weight: 500;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Outer HTML Snippet */
    .ag-html-snippet {
      font-family: monospace;
      font-size: 11px;
      color: #475569;
      background: #f8fafc;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid rgba(0, 0, 0, 0.06);
      max-height: 60px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }

    /* Notes Input */
    .ag-input-label {
      font-weight: 500;
      font-size: 12px;
      color: #374151;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .ag-textarea {
      width: 100%;
      height: 80px;
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 10px;
      padding: 10px 14px;
      font-family: inherit;
      font-size: 13px;
      color: #0f172a;
      resize: vertical;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
      line-height: 1.5;
      box-shadow: 0 2px 4px rgba(0,0,0,0.02);
    }

    .ag-textarea:focus {
      border-color: #007aff;
      box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
    }

    /* Tag Pills */
    .ag-tags-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .ag-tag-btn {
      background: #f3f4f6;
      border: 1px solid rgba(0, 0, 0, 0.05);
      color: #4b5563;
      border-radius: 9999px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .ag-tag-btn:hover {
      background: #e5e7eb;
      color: #111827;
    }

    .ag-tag-btn.selected {
      background: #eff6ff;
      border-color: #007aff;
      color: #007aff;
      font-weight: 500;
    }

    /* Screenshot Snippet Section */
    .ag-screenshot-preview {
      display: flex;
      align-items: center;
      gap: 16px;
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.05);
      border-radius: 12px;
      padding: 12px 16px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.02);
    }

    .ag-thumb-canvas {
      width: 48px;
      height: 48px;
      object-fit: contain;
      background: #ffffff;
      border-radius: 4px;
      border: 1px solid rgba(0, 0, 0, 0.1);
    }

    .ag-screenshot-text {
      font-size: 11px;
      color: #64748b;
      flex: 1;
    }

    /* Modal Footer */
    .ag-modal-footer {
      padding: 14px 20px;
      border-top: 1px solid rgba(0, 0, 0, 0.06);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      background: #f8fafc;
    }

    .ag-btn {
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      letter-spacing: -0.1px;
    }

    .ag-btn-secondary {
      background: #f3f4f6;
      color: #374151;
      border: 1px solid rgba(0, 0, 0, 0.1);
    }

    .ag-btn-secondary:hover {
      background: #e5e7eb;
    }

    .ag-btn-primary {
      background: #007aff;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(0, 122, 255, 0.25);
    }

    .ag-btn-primary:hover {
      background: #006ae6;
      box-shadow: 0 6px 16px rgba(0, 122, 255, 0.35);
      transform: translateY(-1px);
    }

    .ag-btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Toast Notification */
    .ag-toast-container {
      position: fixed;
      top: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 2147483647;
      pointer-events: none;
    }

    .ag-toast {
      pointer-events: auto;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(0, 0, 0, 0.1);
      color: #111827;
      padding: 12px 18px;
      border-radius: 10px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15);
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 10px;
      animation: ag-slide-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      max-width: 360px;
    }

    .ag-toast.success {
      border-left: 4px solid #34c759;
    }

    .ag-toast.resolved {
      border-left: 4px solid #5856d6;
    }

    @keyframes ag-slide-in {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;

  shadow.appendChild(styleSheet);
  // ==========================================
  // DOM Elements Inside Shadow Root
  // ==========================================
  const container = document.createElement('div');
  container.innerHTML = `
    <!-- Fullscreen SVG Canvas for Freeform Area Markings -->
    <svg class="ag-draw-canvas" id="ag-draw-canvas">
      <rect class="ag-shape-preview" id="ag-preview-rect" style="display:none;" />
      <ellipse class="ag-shape-preview" id="ag-preview-ellipse" style="display:none;" />
    </svg>
    <div class="ag-draw-dims" id="ag-draw-dims">0 × 0</div>

    <!-- Persistent Markers Layer -->
    <div class="ag-markers-layer" id="ag-markers-layer"></div>

    <!-- Highlight Box for Element Inspect -->
    <div class="ag-highlight-box" id="ag-highlight">
      <div class="ag-highlight-tag" id="ag-highlight-tag">
        <span id="ag-tag-name">div</span>
        <span class="ag-react-badge" id="ag-tag-react" style="display:none;"></span>
        <span class="ag-dims" id="ag-tag-dims">0 × 0</span>
      </div>
    </div>

    <!-- Mode Selector Toolbar -->
    <div class="ag-toolbar" id="ag-toolbar">
      <button class="ag-tool-btn active" id="btn-mode-inspect" data-mode="inspect" title="Click & inspect DOM elements">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line></svg>
        <span>Element</span>
      </button>
      <button class="ag-tool-btn" id="btn-mode-rect" data-mode="rect" title="Drag to draw a rectangle area anywhere">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><rect x="3" y="3" width="18" height="18" rx="2"></rect></svg>
        <span>Box</span>
      </button>
      <button class="ag-tool-btn" id="btn-mode-circle" data-mode="circle" title="Drag to draw a circle area anywhere">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><circle cx="12" cy="12" r="9"></circle></svg>
        <span>Circle</span>
      </button>
      <button class="ag-tool-btn" id="btn-mode-pin" data-mode="pin" title="Click anywhere to drop a pin marker">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>
        <span>Pin</span>
      </button>
    </div>

    <!-- Floating Pill Widget -->
    <div class="ag-pill" id="ag-pill" title="Toggle Markup Bridge (Alt + Shift + X)">
      <div class="ag-pill-status" id="ag-status-dot"></div>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="22" y1="12" x2="18" y2="12"></line>
        <line x1="6" y1="12" x2="2" y2="12"></line>
        <line x1="12" y1="6" x2="12" y2="2"></line>
        <line x1="12" y1="22" x2="12" y2="18"></line>
      </svg>
      <div class="ag-pill-label">
        <span>Markup</span>
        <span class="ag-pill-badge" id="ag-badge" style="display:none;">0</span>
      </div>
      <div class="ag-pill-shortcut">Alt+Shift+X</div>
      <div class="ag-pill-close" id="ag-pill-close" title="Turn Off Bridge">×</div>
    </div>

    <!-- Modal Backdrop & Dialog -->
    <div class="ag-modal-backdrop" id="ag-modal-backdrop">
      <div class="ag-modal" role="dialog" aria-modal="true">
        <div class="ag-modal-header">
          <div class="ag-modal-title">
            <span id="ag-modal-main-title">UI Feedback</span>
            <span class="ag-react-badge-lg" id="ag-modal-react-badge" style="display:none;"></span>
          </div>
          <button class="ag-modal-close" id="ag-modal-close" title="Close (Esc)">&times;</button>
        </div>

        <div class="ag-modal-body">
          <!-- Element / Area Card -->
          <div class="ag-element-card">
            <div class="ag-selector-row">
              <div class="ag-selector-code" id="ag-modal-selector">#selector</div>
            </div>

            <!-- Spatial Context for Freeform Areas -->
            <div class="ag-area-spatial-hint" id="ag-area-hint" style="display:none;"></div>

            <div class="ag-react-info" id="ag-modal-react-info" style="display:none;">
              <span>Component: <strong id="ag-modal-react-name"></strong></span>
              <span class="ag-source-location" id="ag-modal-source"></span>
            </div>

            <!-- Computed Styles Preview (Hidden for Area Markings) -->
            <div class="ag-styles-grid" id="ag-modal-styles"></div>

            <!-- Outer HTML Snippet (Hidden for Area Markings) -->
            <div class="ag-html-snippet" id="ag-modal-html"></div>
          </div>

          <!-- Screenshot / Canvas Preview -->
          <div class="ag-screenshot-preview">
            <canvas class="ag-thumb-canvas" id="ag-canvas-thumb" width="48" height="48"></canvas>
            <div class="ag-screenshot-text" id="ag-screenshot-dims">
              Viewport bounding snapshot captured
            </div>
          </div>

          <!-- Tag Selection -->
          <div class="ag-tags-row">
            <button class="ag-tag-btn selected" data-tag="styling">Styling</button>
            <button class="ag-tag-btn" data-tag="feature">New Feature</button>
            <button class="ag-tag-btn" data-tag="layout">Layout / Spacing</button>
            <button class="ag-tag-btn" data-tag="content">Text & Content</button>
            <button class="ag-tag-btn" data-tag="bug">Bug</button>
          </div>

          <!-- User Notes -->
          <div>
            <div class="ag-input-label">
              <span>Feedback / Changes for Antigravity:</span>
              <span style="font-size: 10px; color: #94a3b8;">Cmd/Ctrl + Enter to submit</span>
            </div>
            <textarea
              class="ag-textarea"
              id="ag-notes-input"
              placeholder="e.g. Place a new customer testimonial slider here with 3 cards..."
            ></textarea>
          </div>
        </div>

        <div class="ag-modal-footer">
          <button class="ag-btn ag-btn-secondary" id="ag-btn-reselect">Re-pick</button>
          <button class="ag-btn ag-btn-secondary" id="ag-btn-cancel">Cancel</button>
          <button class="ag-btn ag-btn-primary" id="ag-btn-submit">
            <span>Send to Antigravity</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Toast Notifications Container -->
    <div class="ag-toast-container" id="ag-toasts"></div>
  `;
  shadow.appendChild(container);

  // References inside shadow root
  const pill = shadow.getElementById('ag-pill');
  const toolbar = shadow.getElementById('ag-toolbar');
  const statusDot = shadow.getElementById('ag-status-dot');
  const badge = shadow.getElementById('ag-badge');
  const highlightBox = shadow.getElementById('ag-highlight');
  const tagNameEl = shadow.getElementById('ag-tag-name');
  const tagReactEl = shadow.getElementById('ag-tag-react');
  const tagDimsEl = shadow.getElementById('ag-tag-dims');

  const drawCanvas = shadow.getElementById('ag-draw-canvas');
  const previewRect = shadow.getElementById('ag-preview-rect');
  const previewEllipse = shadow.getElementById('ag-preview-ellipse');
  const drawDims = shadow.getElementById('ag-draw-dims');
  const markersLayer = shadow.getElementById('ag-markers-layer');

  const modalBackdrop = shadow.getElementById('ag-modal-backdrop');
  const modalClose = shadow.getElementById('ag-modal-close');
  const modalTitle = shadow.getElementById('ag-modal-main-title');
  const modalSelector = shadow.getElementById('ag-modal-selector');
  const modalAreaHint = shadow.getElementById('ag-area-hint');
  const modalReactBadge = shadow.getElementById('ag-modal-react-badge');
  const modalReactInfo = shadow.getElementById('ag-modal-react-info');
  const modalReactName = shadow.getElementById('ag-modal-react-name');
  const modalSource = shadow.getElementById('ag-modal-source');
  const modalStyles = shadow.getElementById('ag-modal-styles');
  const modalHtml = shadow.getElementById('ag-modal-html');
  const notesInput = shadow.getElementById('ag-notes-input');
  const thumbCanvas = shadow.getElementById('ag-canvas-thumb');
  const screenshotDims = shadow.getElementById('ag-screenshot-dims');
  const btnSubmit = shadow.getElementById('ag-btn-submit');
  const btnCancel = shadow.getElementById('ag-btn-cancel');
  const btnReselect = shadow.getElementById('ag-btn-reselect');
  const toastsContainer = shadow.getElementById('ag-toasts');

  let selectedTag = 'styling';
  let capturedScreenshotData = null;

  // Tag selector buttons
  shadow.querySelectorAll('.ag-tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      shadow.querySelectorAll('.ag-tag-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedTag = btn.getAttribute('data-tag');
    });
  });

  // Mode buttons in Toolbar
  shadow.querySelectorAll('.ag-tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      shadow.querySelectorAll('.ag-tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setMode(btn.getAttribute('data-mode'));
    });
  });

  function setMode(mode) {
    currentMode = mode;
    highlightBox.style.display = 'none';

    if (currentMode === 'inspect') {
      drawCanvas.classList.remove('drawing-active');
      document.body.style.cursor = 'crosshair';
      showToast('Inspect Mode: Click any DOM element.', 'info');
    } else {
      drawCanvas.classList.add('drawing-active');
      document.body.style.cursor = 'crosshair';
      if (currentMode === 'rect') {
        showToast('Rectangle Mode: Click and drag to mark any area.', 'info');
      } else if (currentMode === 'circle') {
        showToast('Circle Mode: Click and drag to draw a circle.', 'info');
      } else if (currentMode === 'pin') {
        showToast('Pin Mode: Click anywhere to drop a marker pin.', 'info');
      }
    }
  }

  // ==========================================
  // Selector & React Fiber Logic
  // ==========================================
  function computeUniqueSelector(el) {
    if (!(el instanceof Element)) return '';
    if (el.id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(el.id)) {
      try {
        if (document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
          return `#${CSS.escape(el.id)}`;
        }
      } catch (_) {}
    }

    for (const attr of ['data-testid', 'data-test', 'data-cy']) {
      const val = el.getAttribute(attr);
      if (val) {
        const testSel = `[${attr}="${CSS.escape(val)}"]`;
        try {
          if (document.querySelectorAll(testSel).length === 1) return testSel;
        } catch (_) {}
      }
    }

    const path = [];
    let curr = el;
    while (curr && curr.nodeType === Node.ELEMENT_NODE) {
      if (curr === document.documentElement) {
        path.unshift('html');
        break;
      }
      if (curr === document.body) {
        path.unshift('body');
        break;
      }

      let tag = curr.tagName.toLowerCase();
      const classes = Array.from(curr.classList || [])
        .filter(c => !c.startsWith('ag-') && !c.startsWith('__ag_') && /^[a-zA-Z0-9_-]{2,30}$/.test(c))
        .slice(0, 2);

      let part = tag + (classes.length > 0 ? '.' + classes.map(c => CSS.escape(c)).join('.') : '');

      if (curr.parentElement) {
        const siblings = Array.from(curr.parentElement.children);
        if (siblings.filter(s => s.tagName === curr.tagName).length > 1) {
          part += `:nth-child(${siblings.indexOf(curr) + 1})`;
        }
      }

      path.unshift(part);

      const full = path.join(' > ');
      try {
        const matches = document.querySelectorAll(full);
        if (matches.length === 1 && matches[0] === el) return full;
      } catch (_) {}

      curr = curr.parentElement;
    }
    return path.join(' > ');
  }

  function getReactContext(el) {
    if (!el) return null;
    try {
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (!fiberKey) return null;

      let fiber = el[fiberKey];
      if (!fiber) return null;

      const hierarchy = [];
      let compName = null;
      let debugSource = null;
      let propsSummary = null;

      let curr = fiber;
      while (curr) {
        const type = curr.type;
        let name = null;
        if (typeof type === 'function') {
          name = type.displayName || type.name;
        } else if (typeof type === 'object' && type) {
          name = type.displayName || (type.render && (type.render.displayName || type.render.name));
        }

        if (name && typeof curr.type !== 'string') {
          hierarchy.unshift(`<${name}>`);
          if (!compName) {
            compName = `<${name}>`;
            if (curr._debugSource) {
              debugSource = {
                file: curr._debugSource.fileName || '',
                line: curr._debugSource.lineNumber || 0,
                column: curr._debugSource.columnNumber || 0
              };
            }
            if (curr.memoizedProps) {
              propsSummary = {};
              for (const [k, v] of Object.entries(curr.memoizedProps)) {
                if (['children', 'key', 'ref'].includes(k)) continue;
                if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                  propsSummary[k] = v;
                }
              }
            }
          }
        }
        curr = curr.return;
      }

      if (!compName) return null;
      return {
        componentName: compName,
        hierarchy,
        source: debugSource,
        props: propsSummary
      };
    } catch (_) {
      return null;
    }
  }

  function getComputedStylesMap(el) {
    if (!el) return {};
    const cs = window.getComputedStyle(el);
    return {
      'display': cs.display,
      'flex-direction': cs.flexDirection,
      'grid-template-columns': cs.gridTemplateColumns !== 'none' ? cs.gridTemplateColumns : undefined,
      'padding': cs.padding,
      'margin': cs.margin,
      'color': cs.color,
      'background-color': cs.backgroundColor,
      'font-size': cs.fontSize,
      'font-family': cs.fontFamily ? cs.fontFamily.split(',')[0].replace(/['"]/g, '') : '',
      'width': `${Math.round(parseFloat(cs.width) || el.offsetWidth || 0)}px`,
      'height': `${Math.round(parseFloat(cs.height) || el.offsetHeight || 0)}px`,
      'border': cs.border,
      'border-radius': cs.borderRadius,
      'box-shadow': cs.boxShadow !== 'none' ? cs.boxShadow : undefined
    };
  }

  // ==========================================
  // Spatial Analysis for Freeform Area Markings
  // ==========================================
  function analyzeMarkedArea(rect, shape = 'rectangle') {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    // Identify underlying container elements
    const elements = document.elementsFromPoint(cx, cy)
      .filter(el => el !== host && !host.contains(el) && el !== document.documentElement && el !== document.body);

    const targetContainer = elements[0] || document.body;
    const containerSelector = computeUniqueSelector(targetContainer);
    const reactCtx = getReactContext(targetContainer);

    // Nearby elements (above/below)
    let relativePosition = `Placed inside <${containerSelector}> at viewport (X: ${Math.round(rect.x)}, Y: ${Math.round(rect.y)}), size: ${Math.round(rect.width)} × ${Math.round(rect.height)} px.`;

    if (targetContainer && targetContainer.children && targetContainer.children.length > 0) {
      const children = Array.from(targetContainer.children);
      const above = children.filter(c => {
        const r = c.getBoundingClientRect();
        return r.bottom <= rect.y;
      }).pop();

      const below = children.filter(c => {
        const r = c.getBoundingClientRect();
        return r.top >= rect.y + rect.height;
      })[0];

      if (above && below) {
        relativePosition += ` Positioned directly between <${above.tagName.toLowerCase()}${above.id ? '#' + above.id : ''}> and <${below.tagName.toLowerCase()}${below.id ? '#' + below.id : ''}>.`;
      } else if (above) {
        relativePosition += ` Positioned below <${above.tagName.toLowerCase()}${above.id ? '#' + above.id : ''}>.`;
      } else if (below) {
        relativePosition += ` Positioned above <${below.tagName.toLowerCase()}${below.id ? '#' + below.id : ''}>.`;
      }
    }

    return {
      shape,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      scroll: {
        x: Math.round(window.scrollX),
        y: Math.round(window.scrollY)
      },
      containerSelector,
      relativePosition,
      reactContext: reactCtx
    };
  }

  // ==========================================
  // Visual Element Snapshot
  // ==========================================
  function captureSnippet(rect, shape = 'rectangle', label = '') {
    try {
      const ctx = thumbCanvas.getContext('2d');
      ctx.clearRect(0, 0, thumbCanvas.width, thumbCanvas.height);

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 48, 48);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';

      const pad = 8;
      if (shape === 'circle') {
        ctx.beginPath();
        ctx.arc(24, 24, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (shape === 'pin') {
        ctx.fillStyle = '#6366f1';
        ctx.beginPath();
        ctx.arc(24, 20, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(23, 26, 2, 10);
      } else {
        ctx.fillRect(pad, pad, 48 - pad * 2, 48 - pad * 2);
        ctx.strokeRect(pad, pad, 48 - pad * 2, 48 - pad * 2);
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(shape.slice(0, 4).toUpperCase(), 24, 24);

      const dataUrl = thumbCanvas.toDataURL('image/png');
      return {
        dataUrl,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    } catch (e) {
      return null;
    }
  }

  // ==========================================
  // Freeform Drawing Handlers
  // ==========================================
  drawCanvas.addEventListener('mousedown', e => {
    if (!isActive || currentMode === 'inspect') return;
    isDrawing = true;
    startX = e.clientX;
    startY = e.clientY;

    if (currentMode === 'rect') {
      previewRect.style.display = 'block';
      previewRect.setAttribute('x', startX);
      previewRect.setAttribute('y', startY);
      previewRect.setAttribute('width', '0');
      previewRect.setAttribute('height', '0');
    } else if (currentMode === 'circle') {
      previewEllipse.style.display = 'block';
      previewEllipse.setAttribute('cx', startX);
      previewEllipse.setAttribute('cy', startY);
      previewEllipse.setAttribute('rx', '0');
      previewEllipse.setAttribute('ry', '0');
    }
  });

  window.addEventListener('mousemove', e => {
    if (!isDrawing) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    if (currentMode === 'rect') {
      previewRect.setAttribute('x', x);
      previewRect.setAttribute('y', y);
      previewRect.setAttribute('width', w);
      previewRect.setAttribute('height', h);
    } else if (currentMode === 'circle') {
      previewEllipse.setAttribute('cx', x + w / 2);
      previewEllipse.setAttribute('cy', y + h / 2);
      previewEllipse.setAttribute('rx', w / 2);
      previewEllipse.setAttribute('ry', h / 2);
    }

    drawDims.style.display = 'block';
    drawDims.style.left = `${Math.min(window.innerWidth - 80, x + w + 8)}px`;
    drawDims.style.top = `${Math.min(window.innerHeight - 30, y + h + 8)}px`;
    drawDims.textContent = `${Math.round(w)} × ${Math.round(h)}`;
  });

  window.addEventListener('mouseup', e => {
    if (!isDrawing) return;
    isDrawing = false;

    previewRect.style.display = 'none';
    previewEllipse.style.display = 'none';
    drawDims.style.display = 'none';

    let x = Math.min(startX, e.clientX);
    let y = Math.min(startY, e.clientY);
    let w = Math.abs(e.clientX - startX);
    let h = Math.abs(e.clientY - startY);

    // If small click or pin mode, default to pin point
    if (currentMode === 'pin' || (w < 8 && h < 8)) {
      w = 32;
      h = 32;
      x = Math.max(0, startX - 16);
      y = Math.max(0, startY - 16);
      openModalForArea({ x, y, width: w, height: h }, 'pin');
      return;
    }

    openModalForArea({ x, y, width: w, height: h }, currentMode);
  });

  // ==========================================
  // Inspector Highlighting (Element Mode)
  // ==========================================
  function updateHighlight(el) {
    if (!el || el === host || host.contains(el)) {
      highlightBox.style.display = 'none';
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      highlightBox.style.display = 'none';
      return;
    }

    highlightBox.style.display = 'block';
    highlightBox.style.top = `${rect.top}px`;
    highlightBox.style.left = `${rect.left}px`;
    highlightBox.style.width = `${rect.width}px`;
    highlightBox.style.height = `${rect.height}px`;

    let tag = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const firstClass = el.className.trim().split(/\s+/)[0];
      if (firstClass && !firstClass.startsWith('ag-')) {
        tag += `.${firstClass}`;
      }
    }
    tagNameEl.textContent = tag;
    tagDimsEl.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;

    const reactCtx = getReactContext(el);
    if (reactCtx && reactCtx.componentName) {
      tagReactEl.style.display = 'inline-block';
      tagReactEl.textContent = reactCtx.componentName;
    } else {
      tagReactEl.style.display = 'none';
    }
  }

  function onMouseMove(e) {
    if (!isActive || isModalOpen || currentMode !== 'inspect') return;

    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === host || host.contains(target)) return;

    hoveredElement = target;
    updateHighlight(target);
  }

  function onElementClick(e) {
    if (!isActive || isModalOpen || currentMode !== 'inspect') return;

    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === host || host.contains(target)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    selectedElement = target;
    currentAreaMarking = null;
    openModalForElement(selectedElement);
  }

  // ==========================================
  // Modal Interactions (Element Mode)
  // ==========================================
  function openModalForElement(el) {
    isModalOpen = true;
    highlightBox.style.display = 'none';

    modalTitle.innerHTML = '<span>Element Feedback</span>';
    modalAreaHint.style.display = 'none';
    modalStyles.style.display = 'grid';
    modalHtml.style.display = 'block';

    const selector = computeUniqueSelector(el);
    const reactCtx = getReactContext(el);
    const styles = getComputedStylesMap(el);

    modalSelector.textContent = selector;

    // React info
    if (reactCtx && reactCtx.componentName) {
      modalReactBadge.style.display = 'inline-block';
      modalReactBadge.textContent = reactCtx.componentName;
      modalReactInfo.style.display = 'flex';
      modalReactName.textContent = reactCtx.componentName;
      if (reactCtx.source && reactCtx.source.file) {
        modalSource.textContent = `${reactCtx.source.file}:${reactCtx.source.line}`;
      } else {
        modalSource.textContent = reactCtx.hierarchy.join(' > ');
      }
    } else {
      modalReactBadge.style.display = 'none';
      modalReactInfo.style.display = 'none';
    }

    // Styles Grid
    modalStyles.innerHTML = '';
    for (const [prop, val] of Object.entries(styles)) {
      if (val === undefined) continue;
      const item = document.createElement('div');
      item.className = 'ag-style-item';
      item.innerHTML = `<span>${prop}:</span><span title="${val}">${val}</span>`;
      modalStyles.appendChild(item);
    }

    // Outer HTML preview (max 400 chars)
    let rawHtml = el.outerHTML || '';
    if (rawHtml.length > 400) {
      rawHtml = rawHtml.slice(0, 397) + '...';
    }
    modalHtml.textContent = rawHtml;

    // Screenshot snippet
    const rect = el.getBoundingClientRect();
    capturedScreenshotData = captureSnippet(rect, 'rectangle', el.tagName.toLowerCase());
    screenshotDims.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)} px (${el.tagName.toLowerCase()})`;

    modalBackdrop.classList.add('open');
    notesInput.value = '';
    notesInput.placeholder = 'e.g. Change this button to emerald green, add 12px padding, and make the font bolder...';
    setTimeout(() => notesInput.focus(), 100);
  }

  // ==========================================
  // Modal Interactions (Area Mode)
  // ==========================================
  function openModalForArea(rect, shape) {
    isModalOpen = true;
    highlightBox.style.display = 'none';
    selectedElement = null;

    currentAreaMarking = analyzeMarkedArea(rect, shape);

    const shapeLabel = shape === 'circle' ? 'Circle Area' : shape === 'pin' ? 'Pin Marker' : 'Rectangle Area';
    modalTitle.innerHTML = `<span>${shapeLabel}</span>`;

    modalSelector.textContent = `Area in <${currentAreaMarking.containerSelector}>`;
    modalAreaHint.style.display = 'block';
    modalAreaHint.innerHTML = `<strong>Spatial Placement:</strong> ${currentAreaMarking.relativePosition}`;

    modalStyles.style.display = 'none';
    modalHtml.style.display = 'none';
    modalReactBadge.style.display = 'none';
    modalReactInfo.style.display = 'none';

    capturedScreenshotData = captureSnippet(rect, shape, shapeLabel);
    screenshotDims.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)} px (${shape})`;

    modalBackdrop.classList.add('open');
    notesInput.value = '';
    notesInput.placeholder = shape === 'pin'
      ? 'e.g. Put a notification bell icon right here...'
      : 'e.g. Add a customer testimonial carousel in this empty area...';
    setTimeout(() => notesInput.focus(), 100);
  }

  function closeModal() {
    isModalOpen = false;
    modalBackdrop.classList.remove('open');
    if (isActive && hoveredElement && currentMode === 'inspect') {
      updateHighlight(hoveredElement);
    }
  }

  // ==========================================
  // Submit Feedback & Add Visual Marker Pin
  // ==========================================
  async function submitFeedback() {
    const notes = notesInput.value.trim();
    if (!notes) {
      notesInput.focus();
      notesInput.style.borderColor = '#ef4444';
      setTimeout(() => (notesInput.style.borderColor = ''), 1500);
      return;
    }

    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<span>Sending...</span>';

    let payload = {};

    const pageContext = {
      url: window.location.href,
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      title: document.title,
      viewport: `${window.innerWidth}x${window.innerHeight}`
    };

    if (currentAreaMarking) {
      // Area or Pin Marking
      payload = {
        url: window.location.href, // kept for backward compatibility
        pageContext,
        selector: currentAreaMarking.containerSelector || 'window',
        outerHTML: `<!-- Area Marking: ${currentAreaMarking.shape.toUpperCase()} at (${currentAreaMarking.rect.x}, ${currentAreaMarking.rect.y}) -->`,
        computedStyles: {},
        reactContext: currentAreaMarking.reactContext || null,
        userNotes: notes,
        tag: selectedTag,
        areaMarking: currentAreaMarking,
        screenshotSnippet: capturedScreenshotData
      };
    } else if (selectedElement) {
      // Element Marking
      const selector = computeUniqueSelector(selectedElement);
      const reactCtx = getReactContext(selectedElement);
      const styles = getComputedStylesMap(selectedElement);
      let outerHTML = selectedElement.outerHTML || '';
      if (outerHTML.length > 400) {
        outerHTML = outerHTML.slice(0, 397) + '...';
      }

      payload = {
        url: window.location.href, // kept for backward compatibility
        pageContext,
        selector,
        outerHTML,
        computedStyles: styles,
        reactContext: reactCtx,
        userNotes: notes,
        tag: selectedTag,
        screenshotSnippet: capturedScreenshotData
      };
    } else {
      btnSubmit.disabled = false;
      return;
    }

    try {
      const res = await fetch(`${BRIDGE_API_BASE}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      showToast(`Feedback queued (#${data.id.slice(-4)})! Antigravity notified.`, 'success');
      pendingCount++;
      updateBadge();

      // Render persistent visual marker pin on the page
      renderPersistentMarker(data);

      closeModal();
    } catch (err) {
      console.error('[MarkupBridge] Failed to send feedback:', err);
      showToast(`Bridge error: Unable to connect to ${BRIDGE_API_BASE}`, 'error');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<span>Send to Antigravity</span>';
    }
  }

  // ==========================================
  // Persistent Visual Marker Pins
  // ==========================================
  function renderPersistentMarker(item) {
    if (!item) return;

    let x = 100, y = 100, w = 40, h = 40, shape = 'rectangle';

    if (item.areaMarking && item.areaMarking.rect) {
      x = item.areaMarking.rect.x + (item.areaMarking.scroll?.x || 0);
      y = item.areaMarking.rect.y + (item.areaMarking.scroll?.y || 0);
      w = item.areaMarking.rect.width;
      h = item.areaMarking.rect.height;
      shape = item.areaMarking.shape;
    } else if (item.screenshotSnippet?.rect) {
      x = item.screenshotSnippet.rect.x + window.scrollX;
      y = item.screenshotSnippet.rect.y + window.scrollY;
      w = item.screenshotSnippet.rect.width;
      h = item.screenshotSnippet.rect.height;
    }

    const pin = document.createElement('div');
    pin.className = 'ag-marker-pin';
    pin.setAttribute('data-id', item.id);
    pin.style.left = `${x + w / 2}px`;
    pin.style.top = `${y}px`;
    pin.title = `${item.userNotes} (${item.status})`;

    const shortId = item.id.slice(-4);
    pin.innerHTML = `
      <div class="ag-marker-badge ${item.status === 'resolved' ? 'resolved' : ''}">
        <span>#${shortId}</span>
      </div>
    `;

    markersLayer.appendChild(pin);
    markers.push({ id: item.id, el: pin });
  }

  // ==========================================
  // Toggle Mode & Activation
  // ==========================================
  function toggleActive() {
    isActive = !isActive;
    if (isActive) {
      pill.classList.add('active');
      toolbar.classList.add('visible');
      setMode(currentMode);
    } else {
      pill.classList.remove('active');
      toolbar.classList.remove('visible');
      highlightBox.style.display = 'none';
      drawCanvas.classList.remove('drawing-active');
      document.body.style.cursor = '';
      if (isModalOpen) closeModal();
    }
  }

  // ==========================================
  // Toast Notifications
  // ==========================================
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `ag-toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'resolved' ? '✓' : type === 'error' ? '!' : '•';
    toast.innerHTML = `<span style="font-weight:700;">${icon}</span><span>${message}</span>`;
    toastsContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  function updateBadge() {
    if (pendingCount > 0) {
      badge.style.display = 'inline-block';
      badge.textContent = pendingCount;
    } else {
      badge.style.display = 'none';
    }
  }

  // ==========================================
  // Bidirectional SSE Integration
  // ==========================================
  function connectSSE() {
    try {
      if (sseConnection) sseConnection.close();
      sseConnection = new EventSource(`${BRIDGE_API_BASE}/api/events`);

      sseConnection.addEventListener('connected', () => {
        statusDot.classList.remove('disconnected');
        statusDot.title = 'Connected to Antigravity Bridge (127.0.0.1:3005)';
      });

      sseConnection.addEventListener('feedback_resolved', e => {
        const item = JSON.parse(e.data);
        const name = item.areaMarking
          ? `${item.areaMarking.shape.toUpperCase()} area in <${item.selector}>`
          : (item.reactContext?.componentName || item.selector || 'Element');

        showToast(`Antigravity resolved ${name}: ${item.resolutionNotes || 'Done'}`, 'resolved');
        if (pendingCount > 0) pendingCount--;
        updateBadge();

        // Update pin badge color to green
        const found = markers.find(m => m.id === item.id);
        if (found) {
          const badgeEl = found.el.querySelector('.ag-marker-badge');
          if (badgeEl) badgeEl.classList.add('resolved');
        }
      });

      sseConnection.onerror = () => {
        statusDot.classList.add('disconnected');
        statusDot.title = 'Disconnected from Antigravity Bridge';
      };
    } catch (_) {}
  }

  // ==========================================
  // Event Listeners
  // ==========================================
  function onGlobalKeyDown(e) {
    if (e.altKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) {
      e.preventDefault();
      toggleActive();
    } else if (e.key === 'Escape' && isModalOpen) {
      closeModal();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && isModalOpen) {
      e.preventDefault();
      submitFeedback();
    }
  }

  window.addEventListener('keydown', onGlobalKeyDown, true);

  // Shutdown completely
  function shutdownBridge() {
    isActive = false;
    isModalOpen = false;
    host.remove();
    window.removeEventListener('keydown', onGlobalKeyDown, true);
    window.removeEventListener('mousemove', onMouseMove, { capture: true, passive: true });
    window.removeEventListener('click', onElementClick, { capture: true });
    if (sseConnection) sseConnection.close();
    
    window.__ANTIGRAVITY_BRIDGE_INITIALIZED__ = false;
    delete window.__ANTIGRAVITY_TOGGLE;
    delete window.__ANTIGRAVITY_SHUTDOWN;
    console.log('[MarkupBridge] Safely shut down.');
  }

  // Expose for extension content.js to trigger directly
  window.__ANTIGRAVITY_TOGGLE = toggleActive;
  window.__ANTIGRAVITY_SHUTDOWN = shutdownBridge;

  pill.addEventListener('click', (e) => {
    // Don't toggle if they clicked the close button
    if (e.target.id === 'ag-pill-close') return;
    toggleActive();
  });
  
  const pillCloseBtn = shadow.getElementById('ag-pill-close');
  pillCloseBtn.addEventListener('click', shutdownBridge);

  modalClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);
  btnReselect.addEventListener('click', () => {
    closeModal();
    isActive = true;
    pill.classList.add('active');
    setMode(currentMode);
  });
  btnSubmit.addEventListener('click', submitFeedback);

  window.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
  window.addEventListener('click', onElementClick, { capture: true });

  connectSSE();

  console.log('[MarkupBridge] Markup Bridge ready with Manual Marking (Box/Circle/Pin) & Element Inspector.');
};

if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
  window.__INIT_MARKUP_BRIDGE__();
}
