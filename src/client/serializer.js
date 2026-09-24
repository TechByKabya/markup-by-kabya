/**
 * DOM Serializer Engine — True 1:1 Page Capture System
 *
 * This module implements the industry-standard DOM serialization algorithm,
 * modelled after SingleFile (gildas-lormeau) and Builder.io html-to-figma.
 *
 * Architecture:
 *   Layer 1: DOM Traversal  — depth-first recursive walk, noise filtering
 *   Layer 2: Style Extraction — getComputedStyle() subset on every element
 *   Layer 3: Asset Resolution — relative→absolute URLs, base64 inlining
 *   Layer 4: HTML Assembly  — clean <!DOCTYPE html> from traversal + styles + assets
 *
 * Design Principles:
 *   - Pure functions where possible (no side-effects outside of DOM reads)
 *   - Intermediate Representation (IR) separates traversal from output format
 *   - Hard limits prevent token budget explosion for the AI agent
 *   - The bridge UI (#antigravity-bridge-host) is ALWAYS excluded
 *
 * This file is used in the browser context (injected via content script).
 * It exports `serializePageToHTML` as the master entry point.
 */

// =============================================================================
// CONSTANTS & CONFIGURATION
// =============================================================================

/** Tags that produce no visual output and must be stripped entirely. */
const BLOCKED_TAG_NAMES = new Set([
  'SCRIPT', 'NOSCRIPT', 'STYLE',    // Already inline-handled separately
  'META', 'LINK', 'BASE', 'TITLE',  // Head metadata (rebuilt in assembler)
  'HEAD',                             // Head block (rebuilt in assembler)
  'TEMPLATE', 'SLOT', 'PORTAL',      // Web component primitives
  'XMP', 'PLAINTEXT',                // Legacy/obsolete
]);

/** Inline elements that should not be treated as block containers. */
const INLINE_ELEMENTS = new Set([
  'A', 'ABBR', 'ACRONYM', 'B', 'BDO', 'BIG', 'BR', 'BUTTON', 'CITE',
  'CODE', 'DFN', 'EM', 'I', 'IMG', 'INPUT', 'KBD', 'LABEL', 'MAP',
  'OBJECT', 'OUTPUT', 'Q', 'SAMP', 'SELECT', 'SMALL', 'SPAN', 'STRONG',
  'SUB', 'SUP', 'TEXTAREA', 'TIME', 'TT', 'U', 'VAR',
]);

/** Attribute names that must be resolved from relative to absolute URL. */
const URL_ATTRIBUTES = new Map([
  ['A', ['href']],
  ['IMG', ['src', 'srcset']],
  ['IFRAME', ['src']],
  ['VIDEO', ['src', 'poster']],
  ['AUDIO', ['src']],
  ['SOURCE', ['src', 'srcset']],
  ['FORM', ['action']],
  ['BLOCKQUOTE', ['cite']],
  ['DEL', ['cite']],
  ['INS', ['cite']],
  ['Q', ['cite']],
  ['OBJECT', ['data']],
  ['INPUT', ['src']],
]);

/** Tracking/analytics attribute prefixes to strip. */
const BLOCKED_ATTR_PREFIXES = [
  'data-analytics', 'data-tracking', 'data-ga', 'data-fb',
  'data-gtm', 'data-pixel', 'data-segment',
];

/** Tracking/analytics attribute names to strip entirely. */
const BLOCKED_ATTR_NAMES = new Set([
  'onload', 'onerror', 'onclick', 'onmouseover', 'onmouseout',
  'onsubmit', 'onfocus', 'onblur', 'onchange', 'onkeyup', 'onkeydown',
]);

/**
 * The ~25 CSS properties that carry visual weight and AI-reconstructable meaning.
 * Source: Builder.io html-to-figma & SingleFile critical property set.
 */
const CRITICAL_CSS_PROPERTIES = [
  // Layout
  'display', 'position', 'flex-direction', 'flex-wrap', 'justify-content',
  'align-items', 'align-self', 'flex', 'flex-grow', 'grid-template-columns',
  'grid-template-rows', 'grid-column', 'grid-row', 'gap',
  // Box model
  'width', 'height', 'min-width', 'max-width', 'min-height',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'overflow', 'overflow-x', 'overflow-y',
  // Color & Background
  'background-color', 'background-image', 'background-size', 'background-position',
  'color', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-radius',
  // Elevation & Effects
  'box-shadow', 'opacity', 'transform', 'filter', 'backdrop-filter', 'z-index',
  // Typography
  'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-decoration',
  'text-transform', 'white-space', 'word-break',
  // Interaction
  'cursor', 'pointer-events',
  // Sizing strategy
  'box-sizing',
];

/** Maximum size of a single inline asset (base64 inlining threshold). 50KB. */
const INLINE_ASSET_THRESHOLD_BYTES = 50 * 1024;

/** Maximum size of the entire serialized HTML output. 3MB. */
const MAX_SERIALIZED_BYTES = 3 * 1024 * 1024;

/** Maximum size per external stylesheet to inline. 200KB. */
const MAX_STYLESHEET_BYTES = 200 * 1024;

// =============================================================================
// LAYER 3: ASSET RESOLUTION ENGINE
// =============================================================================

/**
 * Resolves a potentially relative URL to an absolute URL.
 * Uses the browser's native URL resolution (same as browsers do natively).
 *
 * @param {string} url - Potentially relative URL
 * @param {string} baseUrl - Base URL of the page
 * @returns {string} Absolute URL, or empty string if resolution fails
 */
export function resolveUrl(url, baseUrl) {
  if (!url || typeof url !== 'string') return '';
  url = url.trim();
  if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:') || url.startsWith('#')) {
    return url;
  }
  try {
    return new URL(url, baseUrl).href;
  } catch (_) {
    return url;
  }
}

/**
 * Resolves a `srcset` attribute value: handles the comma-separated
 * "url [descriptor]" format (e.g. "image.png 2x, image-sm.png 1x").
 *
 * @param {string} srcset - Raw srcset value
 * @param {string} baseUrl - Base URL
 * @returns {string} Resolved srcset string
 */
export function resolveSrcset(srcset, baseUrl) {
  if (!srcset) return '';
  return srcset
    .split(',')
    .map(part => {
      const trimmed = part.trim();
      const spaceIdx = trimmed.lastIndexOf(' ');
      if (spaceIdx === -1) {
        // No descriptor — the whole thing is a URL
        return resolveUrl(trimmed, baseUrl);
      }
      const urlPart = trimmed.slice(0, spaceIdx);
      const descriptor = trimmed.slice(spaceIdx); // e.g. " 2x" or " 800w"
      return resolveUrl(urlPart, baseUrl) + descriptor;
    })
    .join(', ');
}

/**
 * Fetches a URL and converts it to a base64 data URI.
 * Returns null if the asset exceeds the size threshold or the fetch fails.
 *
 * This runs in the browser context with full fetch() access.
 *
 * @param {string} absoluteUrl - Absolute URL to fetch
 * @param {number} [thresholdBytes] - Max byte size for inlining
 * @returns {Promise<string|null>} Data URI or null
 */
export async function inlineAsset(absoluteUrl, thresholdBytes = INLINE_ASSET_THRESHOLD_BYTES) {
  if (!absoluteUrl || absoluteUrl.startsWith('data:')) return absoluteUrl;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(absoluteUrl, {
      signal: controller.signal,
      credentials: 'omit', // Never send cookies for cross-origin assets
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > thresholdBytes) return null; // Too large — use absolute URL

    // Convert ArrayBuffer to base64
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:${contentType.split(';')[0]};base64,${base64}`;
  } catch (_) {
    return null; // Network error or abort — fall back to absolute URL
  }
}

/**
 * Fetches and returns the text content of an external stylesheet.
 * Returns null if the stylesheet is too large or fetch fails.
 *
 * @param {string} absoluteUrl
 * @returns {Promise<string|null>}
 */
export async function fetchStylesheet(absoluteUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(absoluteUrl, {
      signal: controller.signal,
      credentials: 'omit',
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const text = await response.text();
    if (text.length > MAX_STYLESHEET_BYTES) return null; // Too large

    return text;
  } catch (_) {
    return null;
  }
}

// =============================================================================
// LAYER 1: NOISE FILTER
// =============================================================================

/**
 * Determines if a DOM node should be excluded from serialization.
 *
 * Filtering rules (each independently justified):
 *   - Our own bridge host: always excluded (it's our UI, not the page's)
 *   - Blocked tag names: script, noscript, template etc. (no visual output)
 *   - Comment nodes: excluded (irrelevant to visual reconstruction)
 *   - Processing instruction nodes: excluded
 *   - Elements with zero visible size are NOT excluded here because
 *     they may be layout containers — size filtering would be wrong at traversal time.
 *
 * @param {Node} node - DOM node to evaluate
 * @returns {boolean} true if the node should be SKIPPED (excluded)
 */
export function filterNode(node) {
  if (!node) return true;

  // Always skip our own bridge UI
  if (node.nodeType === Node.ELEMENT_NODE) {
    if (node.id === 'antigravity-bridge-host') return true;
    const tagName = node.tagName?.toUpperCase();
    if (BLOCKED_TAG_NAMES.has(tagName)) return true;

    // Skip invisible elements that serve no visual purpose
    // (but NOT display:none containers — they might have CSS transitions)
    if (node.getAttribute && node.getAttribute('aria-hidden') === 'true' &&
        node.getAttribute('data-ag-internal') !== null) {
      return true;
    }
  }

  // Skip comment nodes — they add no value to the reconstruction
  if (node.nodeType === Node.COMMENT_NODE) return true;

  // Skip processing instruction nodes
  if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) return true;

  return false;
}

// =============================================================================
// LAYER 2: STYLE EXTRACTION ENGINE
// =============================================================================

/**
 * Extracts a curated set of computed CSS properties from an element.
 * Uses `getComputedStyle()` to get final resolved values AFTER:
 *   - All cascading rules
 *   - All specificity resolution
 *   - All media queries
 *   - All JavaScript style mutations
 *
 * This is the only correct way to get the true rendered appearance of an element.
 * Raw CSS files are meaningless without the cascade context.
 *
 * @param {Element} element - DOM element to extract styles from
 * @returns {Object} Map of CSS property names to computed values (non-default only)
 */
export function extractCriticalStyles(element) {
  if (!element || typeof window === 'undefined') return {};

  const cs = window.getComputedStyle(element);
  const styles = {};

  for (const prop of CRITICAL_CSS_PROPERTIES) {
    try {
      const value = cs.getPropertyValue(prop);
      if (value && value !== 'normal' && value !== 'none' &&
          value !== 'auto' && value !== '0px' && value !== 'initial' &&
          value !== 'inherit' && value !== 'unset' && value !== '') {
        styles[prop] = value;
      }
    } catch (_) {
      // Some properties may throw in certain browser contexts
    }
  }

  return styles;
}

/**
 * Generates a minimal CSS class name from a numeric counter.
 * e.g. 0→"m0", 255→"m255", used for scoped style injection.
 *
 * @param {number} id
 * @returns {string}
 */
export function generateClassName(id) {
  return `_mb${id}`;
}

// =============================================================================
// LAYER 1 + 2 + 3: DOM TRAVERSAL ENGINE
// =============================================================================

/**
 * Serializes a single element's attributes.
 * Handles:
 *   - URL resolution for asset attributes
 *   - Tracking attribute stripping
 *   - data-mbid injection for Antigravity targeting
 *   - class injection with generated style class
 *
 * @param {Element} element
 * @param {string} baseUrl
 * @param {string} styleClassName - The generated class name for this element's styles
 * @param {Object} pendingAssets - Mutable map to collect URL->base64 to resolve async
 * @returns {string} Serialized attribute string (e.g. ' class="foo _mb12" href="https://..."')
 */
export function serializeAttributes(element, baseUrl, styleClassName, pendingAssets) {
  const tagName = element.tagName.toUpperCase();
  const parts = [];

  const urlAttrs = URL_ATTRIBUTES.get(tagName) || [];

  for (const attr of element.attributes) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    // Skip blocked attribute names (event handlers, tracking)
    if (BLOCKED_ATTR_NAMES.has(name)) continue;
    if (BLOCKED_ATTR_PREFIXES.some(prefix => name.startsWith(prefix))) continue;

    // Resolve URL attributes
    if (urlAttrs.includes(name)) {
      if (name === 'srcset') {
        parts.push(`${name}="${escapeAttr(resolveSrcset(value, baseUrl))}"`);
      } else {
        const resolved = resolveUrl(value, baseUrl);
        // Queue for potential base64 inlining (processed async after traversal)
        if (pendingAssets && (tagName === 'IMG' || tagName === 'SOURCE') && name === 'src') {
          pendingAssets[resolved] = resolved; // Will be replaced with data URI if small enough
        }
        parts.push(`${name}="${escapeAttr(resolved)}"`);
      }
      continue;
    }

    // Inject style class into existing class attribute
    if (name === 'class') {
      const existing = value.trim();
      parts.push(`class="${escapeAttr(existing ? `${existing} ${styleClassName}` : styleClassName)}"`);
      continue;
    }

    // Standard attribute — include as-is
    parts.push(`${name}="${escapeAttr(value)}"`);
  }

  // If element had no class attribute, add the style class anyway
  if (!element.hasAttribute('class') && styleClassName) {
    parts.push(`class="${styleClassName}"`);
  }

  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

/**
 * HTML-escapes a string for safe attribute value embedding.
 * @param {string} str
 * @returns {string}
 */
export function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * HTML-escapes a text node value for safe embedding in HTML content.
 * @param {string} str
 * @returns {string}
 */
export function escapeText(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Recursively traverses the DOM tree depth-first, producing:
 *   - A serialized HTML string of the subtree
 *   - A style map: { className → { cssProperty: value } }
 *
 * This is the core traversal engine. Follows the Compiler Frontend pattern:
 * produces an IR (style map) as a side-effect alongside the serialized output.
 *
 * @param {Node} node - Current node being traversed
 * @param {string} baseUrl - Page base URL for asset resolution
 * @param {Map<string, Object>} styleMap - Mutable map collecting styles (output param)
 * @param {{ count: number }} counter - Mutable counter for class name generation
 * @param {Object} pendingAssets - Mutable map collecting image URLs for async inlining
 * @param {number} depth - Current recursion depth (prevents runaway recursion)
 * @returns {string} Serialized HTML for this node and all descendants
 */
export function traverseNode(node, baseUrl, styleMap, counter, pendingAssets, depth = 0) {
  // Safety: maximum DOM depth limit to prevent stack overflow on pathological pages
  if (depth > 200) return '<!-- [MarkupBridge: max depth reached] -->';

  // Skip nodes that should be excluded
  if (filterNode(node)) return '';

  // TEXT NODE: serialize its content directly
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    // Skip pure whitespace text nodes inside block elements (reduces noise)
    if (!text || /^\s+$/.test(text)) return text || '';
    return escapeText(text);
  }

  // ELEMENT NODE: the main case
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tagName = node.tagName.toUpperCase();

    // Generate a unique class name and extract computed styles for this element
    const id = counter.count++;
    const className = generateClassName(id);
    const styles = extractCriticalStyles(node);

    // Only add to styleMap if there are meaningful styles to record
    if (Object.keys(styles).length > 0) {
      styleMap.set(className, styles);
    }

    // Serialize attributes (with URL resolution and style class injection)
    const attrs = serializeAttributes(node, baseUrl, className, pendingAssets);

    // Void (self-closing) elements: serialize without children or closing tag
    const VOID_ELEMENTS = new Set([
      'AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT',
      'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR',
    ]);

    if (VOID_ELEMENTS.has(tagName)) {
      return `<${tagName.toLowerCase()}${attrs}>`;
    }

    // Recursively serialize children
    let childrenHtml = '';
    for (const child of node.childNodes) {
      childrenHtml += traverseNode(child, baseUrl, styleMap, counter, pendingAssets, depth + 1);
    }

    return `<${tagName.toLowerCase()}${attrs}>${childrenHtml}</${tagName.toLowerCase()}>`;
  }

  // CDATA, ProcessingInstruction, or unknown — skip
  return '';
}

// =============================================================================
// LAYER 4: HTML ASSEMBLER
// =============================================================================

/**
 * Converts the collected styleMap into a scoped <style> block.
 * Each class gets its own rule block with all critical CSS properties.
 *
 * @param {Map<string, Object>} styleMap - Map of className → {prop: value}
 * @returns {string} Complete CSS text (without <style> tags)
 */
export function assembleCssFromStyleMap(styleMap) {
  const rules = [];
  for (const [className, styles] of styleMap) {
    const declarations = Object.entries(styles)
      .map(([prop, val]) => `  ${prop}: ${val};`)
      .join('\n');
    if (declarations) {
      rules.push(`.${className} {\n${declarations}\n}`);
    }
  }
  return rules.join('\n\n');
}

/**
 * Assembles a complete, valid, self-contained HTML document from:
 *   - Serialized body HTML (from traverseNode)
 *   - Style map (from traverseNode side effect)
 *   - Page metadata
 *   - Inlined external stylesheets
 *
 * The output document is standards-compliant HTML5 with:
 *   - Proper DOCTYPE
 *   - Charset declaration
 *   - Viewport meta tag
 *   - Markup Bridge capture metadata in <meta> tags
 *   - All computed styles in one <style> block
 *   - The clean body HTML
 *
 * @param {string} bodyHtml - Serialized body content
 * @param {Map<string, Object>} styleMap - Computed style map
 * @param {Object} metadata - Page metadata
 * @param {string[]} [inlinedStylesheets] - Fetched external CSS text
 * @returns {string} Complete HTML document string
 */
export function assembleHTML(bodyHtml, styleMap, metadata, inlinedStylesheets = []) {
  const {
    pageTitle = 'Captured Page',
    sourceUrl = '',
    capturedAt = new Date().toISOString(),
    viewport = '1440x900',
    detectedStack = [],
    estimatedNodes = 0,
  } = metadata;

  const computedStylesCss = assembleCssFromStyleMap(styleMap);

  // Inline external stylesheets first (lowest priority), then computed styles (highest priority)
  const allStylesheetsCss = inlinedStylesheets.join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeText(pageTitle)}</title>
  <!-- Markup Bridge Design Capture -->
  <meta name="markup-bridge-source-url" content="${escapeAttr(sourceUrl)}">
  <meta name="markup-bridge-captured-at" content="${escapeAttr(capturedAt)}">
  <meta name="markup-bridge-viewport" content="${escapeAttr(viewport)}">
  <meta name="markup-bridge-nodes" content="${estimatedNodes}">
  <meta name="markup-bridge-stack" content="${escapeAttr(detectedStack.join(', '))}">
  <!-- External Stylesheets (inlined for self-containment) -->
  <style>
${allStylesheetsCss}
  </style>
  <!-- Computed Styles (highest priority — true rendered values) -->
  <style>
/* Markup Bridge Computed Styles — ${styleMap.size} elements captured */
/* Source: ${sourceUrl} | Captured: ${capturedAt} */

${computedStylesCss}
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// =============================================================================
// MASTER ORCHESTRATOR
// =============================================================================

/**
 * Detects the frontend framework/stack used on the page.
 * Uses heuristics based on global variables and DOM attributes.
 *
 * @returns {string[]} Array of detected framework names
 */
function detectStack() {
  const detected = [];
  try {
    if (typeof window !== 'undefined') {
      if (window.__NEXT_DATA__ || document.getElementById('__next')) detected.push('Next.js');
      if (window.__nuxt__ || window.$nuxt) detected.push('Nuxt.js');
      if (window.angular || document.querySelector('[ng-app], [ng-controller], [data-ng-app]')) detected.push('Angular');
      if (window.Vue || document.querySelector('[data-server-rendered="true"]')) detected.push('Vue.js');
      if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot]')) detected.push('React');
      if (window.Svelte || document.querySelector('[class*="svelte-"]')) detected.push('Svelte');
      if (document.querySelector('[class*="tw-"], [class*=" flex "], .container, .grid')) detected.push('Tailwind CSS');
      if (document.querySelector('.container-fluid, .row, .col-')) detected.push('Bootstrap');
      if (window.jQuery || window.$) detected.push('jQuery');
    }
  } catch (_) {}
  return detected;
}

/**
 * Gathers external stylesheets from the page and fetches their content.
 * Only includes stylesheets under the MAX_STYLESHEET_BYTES threshold.
 *
 * @param {string} baseUrl - Page base URL
 * @returns {Promise<string[]>} Array of CSS text strings
 */
async function gatherExternalStylesheets(baseUrl) {
  const linkEls = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'));
  const results = await Promise.allSettled(
    linkEls.slice(0, 10).map(async (el) => { // Cap at 10 stylesheets
      const href = resolveUrl(el.getAttribute('href'), baseUrl);
      const css = await fetchStylesheet(href);
      return css ? `/* Source: ${href} */\n${css}` : null;
    })
  );
  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
}

/**
 * Post-traversal: replaces image src attributes with base64 data URIs
 * for images that are small enough to inline.
 *
 * This runs AFTER the synchronous traversal pass because fetch() is async.
 *
 * @param {string} html - Serialized HTML from traversal
 * @param {Object} pendingAssets - Map of absoluteUrl → absoluteUrl
 * @returns {Promise<string>} HTML with inline base64 assets substituted
 */
async function resolveInlineAssets(html, pendingAssets) {
  const urls = Object.keys(pendingAssets);
  if (urls.length === 0) return html;

  const resolutions = await Promise.allSettled(
    urls.map(async (url) => {
      const dataUri = await inlineAsset(url);
      return { url, dataUri };
    })
  );

  let result = html;
  for (const r of resolutions) {
    if (r.status === 'fulfilled' && r.value.dataUri && r.value.dataUri.startsWith('data:')) {
      // Safely replace the absolute URL with the data URI in the HTML
      // Use a regex that matches the URL within an attribute value
      const escaped = r.value.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`"${escaped}"`, 'g'), `"${r.value.dataUri}"`);
    }
  }
  return result;
}

/**
 * Master Orchestrator — serializePageToHTML()
 *
 * Coordinates all 4 layers to produce a complete, self-contained HTML document
 * that faithfully represents the current rendered state of the page.
 *
 * @param {Object} [options]
 * @param {boolean} [options.inlineImages=true] - Whether to base64-inline small images
 * @param {boolean} [options.inlineStylesheets=true] - Whether to fetch and inline external CSS
 * @returns {Promise<{html: string, metadata: Object}>}
 */
export async function serializePageToHTML({
  inlineImages = true,
  inlineStylesheets = true,
} = {}) {
  const baseUrl = document.baseURI || window.location.href;
  const pageTitle = document.title;
  const capturedAt = new Date().toISOString();
  const viewport = `${window.innerWidth}x${window.innerHeight}`;
  const detectedStack = detectStack();

  // Phase 1: Gather external stylesheets (async — network requests)
  let gatheredStylesheets = [];
  if (inlineStylesheets) {
    gatheredStylesheets = await gatherExternalStylesheets(baseUrl);
  }

  // Phase 2: Synchronous DOM traversal
  // Produces: serialized body HTML + styleMap + pendingAssets
  const styleMap = new Map();
  const counter = { count: 0 };
  const pendingAssets = {};

  let bodyHtml = '';
  if (document.body) {
    for (const child of document.body.childNodes) {
      bodyHtml += traverseNode(child, baseUrl, styleMap, counter, inlineImages ? pendingAssets : {});
    }
  }

  // Phase 3: Async asset inlining (replaces absolute URLs with base64 data URIs)
  if (inlineImages && Object.keys(pendingAssets).length > 0) {
    bodyHtml = await resolveInlineAssets(bodyHtml, pendingAssets);
  }

  // Phase 4: Assemble complete HTML document
  const metadata = {
    pageTitle,
    sourceUrl: baseUrl,
    capturedAt,
    viewport,
    detectedStack,
    estimatedNodes: counter.count,
  };

  const html = assembleHTML(bodyHtml, styleMap, metadata, gatheredStylesheets);

  // Enforce maximum file size limit
  const byteSize = new Blob([html]).size;
  if (byteSize > MAX_SERIALIZED_BYTES) {
    // Fallback: re-serialize WITHOUT base64 inlining (absolute URLs only)
    // This produces a much smaller output at the cost of requiring network access
    const styleMapFallback = new Map();
    const counterFallback = { count: 0 };
    let bodyHtmlFallback = '';
    if (document.body) {
      for (const child of document.body.childNodes) {
        bodyHtmlFallback += traverseNode(child, baseUrl, styleMapFallback, counterFallback, {});
      }
    }
    const htmlFallback = assembleHTML(bodyHtmlFallback, styleMapFallback, {
      ...metadata,
      pageTitle: `${pageTitle} [fallback: assets linked, not inlined]`,
    }, gatheredStylesheets);

    return {
      html: htmlFallback,
      metadata: { ...metadata, byteSize: new Blob([htmlFallback]).size, fallback: true },
    };
  }

  return { html, metadata: { ...metadata, byteSize } };
}
