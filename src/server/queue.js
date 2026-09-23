import fs from 'node:fs';
import path from 'node:path';

export class FeedbackQueue {
  constructor(storageDir = path.resolve(process.cwd(), '.antigravity')) {
    this.storageDir = storageDir;
    this.storageFile = path.join(this.storageDir, 'ui_feedback_queue.json');
    this.items = [];
    this.listeners = new Set();
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
        this.persist();
      }
    } catch (err) {
      console.error('[FeedbackQueue] Error initializing queue:', err.message);
      this.items = [];
    }
  }

  persist() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
      fs.writeFileSync(this.storageFile, JSON.stringify(this.items, null, 2), 'utf8');
    } catch (err) {
      console.error('[FeedbackQueue] Error writing to disk:', err.message);
    }
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
      screenshotSnippet: data.screenshotSnippet || null,
      areaMarking: data.areaMarking || null,
      resolutionNotes: null,
      resolvedAt: null
    };

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
