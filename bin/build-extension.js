#!/usr/bin/env node

/**
 * Extension Builder & Packager
 * Synchronizes client.js to extension/client.bundle.js
 * and packages extension/ into a distributable extension.zip file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const clientSrc = path.join(rootDir, 'src', 'client', 'client.js');
const extensionDir = path.join(rootDir, 'extension');
const extensionBundle = path.join(extensionDir, 'client.bundle.js');
const zipOut = path.join(rootDir, 'markup-bridge-extension.zip');

console.log('[Build] Packaging Markup Bridge Chrome Extension...');

// 1. Copy client.js to extension/client.bundle.js
if (fs.existsSync(clientSrc)) {
  fs.copyFileSync(clientSrc, extensionBundle);
  console.log(`[Build] Synced: src/client/client.js -> extension/client.bundle.js (${(fs.statSync(extensionBundle).size / 1024).toFixed(1)} KB)`);
} else {
  console.error(`[Build] Error: Could not find ${clientSrc}`);
  process.exit(1);
}

// 2. Package into zip file for easy distribution
try {
  if (fs.existsSync(zipOut)) {
    fs.unlinkSync(zipOut);
  }
  execSync(`cd "${rootDir}" && zip -q -r "${zipOut}" extension/ -x "extension/.DS_Store"`, { stdio: 'inherit' });
  console.log(`[Build] Created distribution package: markup-bridge-extension.zip (${(fs.statSync(zipOut).size / 1024).toFixed(1)} KB)`);
} catch (err) {
  console.warn('[Build] Warning: Could not create zip archive:', err.message);
}

console.log('[Build] Extension build complete. Ready for Chrome Developer Mode or download.');
