import fs from 'node:fs';
import path from 'node:path';

// Storage dir resolution:
//   1. MARKUP_BRIDGE_STORAGE env var — always set by mcp_config.json in MCP daemon mode
//   2. process.cwd()/.antigravity — correct for normal `npx markup-bridge` terminal use
const DEFAULT_STORAGE_DIR =
  process.env.MARKUP_BRIDGE_STORAGE ||
  path.resolve(process.cwd(), '.antigravity');

export class FeedbackQueue {
  constructor(storageDir = DEFAULT_STORAGE_DIR) {
    this.storageDir = storageDir;
    this.storageFile = path.join(this.storageDir, 'ui_feedback_queue.json');
    this.items = [];
    this.listeners = new Set();
    // Debounce state for async writes
    this._persistTimer = null;
    this._persistPromise = null;
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }

      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed;
        }
      } else {
        this._writeToDisk();
      }
    } catch (err) {
      console.error('[FeedbackQueue] Error initializing queue:', err.message);
      this.items = [];
    }
  }

  setStorageDir(newStorageDir) {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
      try {
        if (this.storageDir && fs.existsSync(this.storageDir)) {
          fs.writeFileSync(this.storageFile, JSON.stringify(this.items, null, 2), 'utf8');
        }
      } catch (_) {}
    }
    this.storageDir = path.resolve(newStorageDir);
    this.storageFile = path.join(this.storageDir, 'ui_feedback_queue.json');
    this.items = [];
    this.init();
  }

  /**
   * Debounced async persist — coalesces rapid writes into a single disk write.
   * Multiple calls within 50ms will only result in one file write.
   */
  persist() {
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._writeToDisk();
    }, 50);
  }

  async _writeToDisk() {
    // If a write is already in flight, chain onto it to avoid interleaving
    const doWrite = async () => {
      try {
        if (!fs.existsSync(this.storageDir)) {
          await fs.promises.mkdir(this.storageDir, { recursive: true });
        }
        // Write to a temp file then atomically rename to avoid partial reads
        const tmp = this.storageFile + '.tmp';
        await fs.promises.writeFile(tmp, JSON.stringify(this.items, null, 2), 'utf8');
        await fs.promises.rename(tmp, this.storageFile);
      } catch (err) {
        console.error('[FeedbackQueue] Error writing to disk:', err.message);
      }
    };

    this._persistPromise = this._persistPromise
      ? this._persistPromise.then(doWrite, doWrite)
      : doWrite();

    return this._persistPromise;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event, data) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (err) {
        console.error('[FeedbackQueue] Listener error:', err);
      }
    }
  }

  generateId() {
    return `fb_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  sanitizeOuterHTML(html) {
    if (!html || typeof html !== 'string') return '';
    const cleaned = html.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= 400) return cleaned;
    return cleaned.slice(0, 397) + '...';
  }

  /**
   * generateActionCommand — produces a compact, pre-digested single instruction
   * string that Antigravity can act on immediately without any MCP tool calls.
   *
   * Format:
   *   Change "[userNotes]" in [component] ([file:line])
   *   Selector: [selector]
   *   Action: Edit [file] and apply the change. Then call resolve_ui_feedback({ id: "[id]", resolutionNotes: "..." })
   */
  generateActionCommand(item) {
    const lines = [];

    // Human-readable change instruction
    const change = item.userNotes
      ? `"${item.userNotes}"`
      : 'UI modification requested (no notes provided)';

    // Design Clone Request — True DOM Serializer Protocol
    // The serialized HTML is stored on disk; the action command tells Antigravity
    // to call view_file on the design file path to read the full page structure.
    if (item.tag === 'design-clone') {
      const meta = item.designMetadata || {};
      const title = meta.pageTitle || item.pageTitle || 'Captured Page';
      const sourceUrl = meta.sourceUrl || item.url || 'unknown';
      const capturedAt = meta.capturedAt ? new Date(meta.capturedAt).toLocaleString() : 'unknown';
      const viewport = meta.viewport || 'unknown';
      const nodes = meta.estimatedNodes || 0;
      const kbSize = meta.fileSizeBytes ? Math.round(meta.fileSizeBytes / 1024) : '?';
      const stack = (meta.detectedStack || []).join(', ') || 'Unknown';
      const fallbackNote = meta.fallback ? ' [fallback mode: assets linked, not inlined]' : '';

      lines.push(`🎯 FULL PAGE CLONE READY: "${title}"`);
      lines.push(`Source: ${sourceUrl}`);
      lines.push(`Captured: ${capturedAt} | Viewport: ${viewport} | ${nodes} nodes | ${kbSize} KB | Stack: ${stack}${fallbackNote}`);

      if (item.designFilePath) {
        lines.push('');
        lines.push(`📄 Design File: \`${item.designFilePath}\``);
        lines.push('');
        lines.push('INSTRUCTIONS:');
        lines.push(`1. Call view_file on the Design File path above to read the complete`);
        lines.push(`   HTML structure, text content, colors, layout, and component hierarchy.`);
        lines.push(`2. Recreate this page in production-quality code matching the project stack.`);
        lines.push(`3. Preserve ALL real content: headings, body text, navigation, tables, footer.`);
        lines.push(`4. Translate computed CSS styles into the project's styling system.`);
        lines.push(`   Do NOT use placeholder colors, fonts, or lorem ipsum.`);
        lines.push(`5. After implementation, call resolve_ui_feedback({ id: "${item.id}", resolutionNotes: "..." })`);
      } else {
        // Fallback: no file path (server was offline when captured)
        lines.push(change);
        lines.push(`→ Recreate this page in the codebase, then call resolve_ui_feedback({ id: "${item.id}", resolutionNotes: "Implemented page redesign" })`);
      }

      lines.push('');
      lines.push(`Feedback ID: \`${item.id}\``);
      return lines.join('\n');
    }

    // Component / target
    const component = item.reactContext?.componentName || null;
    const sourceFile = item.reactContext?.source?.file || null;
    const sourceLine = item.reactContext?.source?.line || null;

    // Derive best file path
    let filePath = null;
    if (sourceFile) {
      filePath = sourceLine ? `${sourceFile}:${sourceLine}` : sourceFile;
    } else if (item.url && item.url.startsWith('file://')) {
      try {
        let p = new URL(item.url).pathname;
        if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
        filePath = decodeURIComponent(p);
      } catch (_) {}
    }

    // Freeform area marking metadata
    const isAreaMarking = !!item.areaMarking;
    const markingType = item.areaMarking?.shape;
    const markingHint = item.areaMarking?.relativePosition;
    const markingContainer = item.areaMarking?.containerSelector;

    // Compose the action command
    if (isAreaMarking) {
      lines.push(`Add new content in a marked ${markingType || 'area'} region.`);
      if (markingContainer) lines.push(`Container element: \`${markingContainer}\``);
      if (markingHint) lines.push(`Placement: ${markingHint}`);
      lines.push(`User request: ${change}`);
    } else {
      if (component) {
        lines.push(`Change ${change} in component \`${component}\``);
      } else {
        lines.push(`Change ${change}`);
      }
    }

    if (filePath) lines.push(`File: \`${filePath}\``);
    lines.push(`Selector: \`${item.selector}\``);
    lines.push(`Feedback ID: \`${item.id}\``);
    lines.push(`→ Edit the file above to apply the change, then call resolve_ui_feedback({ id: "${item.id}", resolutionNotes: "..." })`);

    return lines.join('\n');
  }

  addFeedback(data) {
    const feedback = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      status: 'pending',
      url: data.url || '',
      selector: data.selector || 'unknown',
      outerHTML: this.sanitizeOuterHTML(data.outerHTML),
      computedStyles: data.computedStyles || {},
      reactContext: data.reactContext || null,
      userNotes: (data.userNotes || '').trim(),
      tag: data.tag || 'general',
      pageTitle: data.pageTitle || data.pageContext?.title || '',
      // Design Clone fields — file path reference instead of inline HTML/blueprint
      designFilePath: data.designFilePath || null,
      designMetadata: data.designMetadata || null,
      screenshotSnippet: data.screenshotSnippet || null,
      areaMarking: data.areaMarking || null,
      resolutionNotes: null,
      resolvedAt: null
    };

    // Pre-digest into a compact action command at creation time
    feedback.actionCommand = this.generateActionCommand(feedback);

    this.items.unshift(feedback);
    this.persist();
    this.emit('created', feedback);
    return feedback;
  }

  listFeedback({ status = 'all', limit = 50 } = {}) {
    let filtered = this.items;
    if (status && status !== 'all') {
      filtered = filtered.filter(item => item.status === status);
    }
    return filtered.slice(0, limit);
  }

  getFeedback(id) {
    return this.items.find(item => item.id === id) || null;
  }

  getLatestPending() {
    return this.items.find(item => item.status === 'pending') || null;
  }

  updateFeedback(id, updates) {
    const index = this.items.findIndex(item => item.id === id);
    if (index === -1) return null;

    const current = this.items[index];
    const updated = {
      ...current,
      ...updates
    };

    if (updates.status === 'resolved' && !updated.resolvedAt) {
      updated.resolvedAt = new Date().toISOString();
    }

    this.items[index] = updated;
    this.persist();
    this.emit('updated', updated);
    return updated;
  }

  deleteFeedback(id) {
    const index = this.items.findIndex(item => item.id === id);
    if (index === -1) return false;

    const [deleted] = this.items.splice(index, 1);
    this.persist();
    this.emit('deleted', deleted);
    return true;
  }

  clearQueue({ status = 'all' } = {}) {
    if (status === 'all') {
      this.items = [];
    } else {
      this.items = this.items.filter(item => item.status !== status);
    }
    this.persist();
    this.emit('cleared', { status });
    return true;
  }
}
