/**
 * Design Store — Atomic file persistence layer for serialized page captures.
 *
 * Responsibilities:
 *   - Generate URL-safe slugs for captured pages
 *   - Atomically write serialized HTML to .antigravity/designs/<slug>.html
 *   - Never corrupt existing designs (write to .tmp, then rename)
 *   - Provide metadata about stored designs
 *
 * Architectural principle:
 *   This module has ZERO coupling to FeedbackQueue. It only deals with
 *   the file system. The queue stores a path reference to what this module writes.
 */

import fs from 'node:fs';
import path from 'node:path';

const DESIGNS_SUBDIR = 'designs';

/**
 * Generates a URL-safe, human-readable slug from a page URL and timestamp.
 *
 * Examples:
 *   "https://stripe.com/pricing" → "stripe-com-pricing-2026-09-24T0146"
 *   "https://shimu-rezampcollege.edu.bd/" → "shimu-rezampcollege-edu-bd-2026-09-24T0146"
 *
 * @param {string} url - The source page URL
 * @param {Date} [date] - Optional date override (defaults to now)
 * @returns {string} URL-safe slug (without .html extension)
 */
export function generateSlug(url, date = new Date()) {
  let slug = '';

  try {
    const parsed = new URL(url);
    // Combine hostname + pathname, strip www prefix
    const hostPart = parsed.hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '-');
    const pathPart = parsed.pathname
      .replace(/^\/|\/$/g, '')           // strip leading/trailing slashes
      .replace(/[^a-z0-9-]/gi, '-')      // replace non-alphanumeric with dash
      .replace(/-+/g, '-')               // collapse consecutive dashes
      .slice(0, 40);                     // max 40 chars from path

    slug = pathPart ? `${hostPart}-${pathPart}` : hostPart;
  } catch (_) {
    // Fallback for non-standard URLs
    slug = url.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(0, 60);
  }

  // Append timestamp suffix for uniqueness (YYYY-MM-DDTHHMM)
  const ts = date.toISOString()
    .slice(0, 16)          // "2026-09-24T01:46"
    .replace(/:/g, '');    // → "2026-09-24T0146"

  return `${slug.replace(/-+$/g, '')}-${ts}`.toLowerCase();
}

/**
 * Returns the absolute path to the designs directory, creating it if needed.
 *
 * @param {string} storageDir - Root storage directory (e.g. "/project/.antigravity")
 * @returns {string} Absolute path to designs directory
 */
export function ensureDesignsDir(storageDir) {
  const designsDir = path.join(storageDir, DESIGNS_SUBDIR);
  if (!fs.existsSync(designsDir)) {
    fs.mkdirSync(designsDir, { recursive: true });
  }
  return designsDir;
}

/**
 * Returns the full absolute path for a design file given its slug.
 *
 * @param {string} storageDir - Root storage directory
 * @param {string} slug - Design slug (from generateSlug)
 * @returns {string} Absolute path to the .html file
 */
export function getDesignFilePath(storageDir, slug) {
  return path.join(storageDir, DESIGNS_SUBDIR, `${slug}.html`);
}

/**
 * Atomically writes serialized HTML to disk.
 *
 * Uses the write-to-tmp-then-rename pattern to guarantee:
 *   - No partial/corrupt reads if the process crashes mid-write
 *   - Readers always see either the old complete file or the new complete file
 *
 * @param {string} storageDir - Root storage directory
 * @param {string} slug - Design slug
 * @param {string} htmlContent - Complete serialized HTML string
 * @returns {Promise<{filePath: string, slug: string, fileSizeBytes: number}>}
 */
export async function writeDesignFile(storageDir, slug, htmlContent) {
  const designsDir = ensureDesignsDir(storageDir);
  const filePath = path.join(designsDir, `${slug}.html`);
  const tmpPath = filePath + '.tmp';

  try {
    await fs.promises.writeFile(tmpPath, htmlContent, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    // Clean up .tmp file on failure
    try { await fs.promises.unlink(tmpPath); } catch (_) {}
    throw err;
  }

  const fileSizeBytes = Buffer.byteLength(htmlContent, 'utf8');
  return { filePath, slug, fileSizeBytes };
}

/**
 * Lists all designs in the designs directory.
 *
 * @param {string} storageDir - Root storage directory
 * @returns {Array<{slug: string, filePath: string, fileSizeBytes: number, createdAt: Date}>}
 */
export function listDesigns(storageDir) {
  const designsDir = path.join(storageDir, DESIGNS_SUBDIR);
  if (!fs.existsSync(designsDir)) return [];

  try {
    return fs.readdirSync(designsDir)
      .filter(f => f.endsWith('.html') && !f.endsWith('.tmp'))
      .map(f => {
        const filePath = path.join(designsDir, f);
        const stat = fs.statSync(filePath);
        return {
          slug: f.replace(/\.html$/, ''),
          filePath,
          fileSizeBytes: stat.size,
          createdAt: stat.birthtime
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt); // newest first
  } catch (_) {
    return [];
  }
}

/**
 * Deletes a design file by slug.
 *
 * @param {string} storageDir - Root storage directory
 * @param {string} slug - Design slug to delete
 * @returns {boolean} true if deleted, false if not found
 */
export function deleteDesign(storageDir, slug) {
  const filePath = getDesignFilePath(storageDir, slug);
  if (!fs.existsSync(filePath)) return false;
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (_) {
    return false;
  }
}
