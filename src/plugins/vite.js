/**
 * Zero-Configuration Vite Plugin for Markup Bridge
 * Automatically injects the bridge client script in development mode.
 * Works with React, Vue, Svelte, Solid, and Vanilla Vite projects.
 *
 * Usage in vite.config.js / vite.config.ts:
 *   import { markupBridge } from 'markup-by-kabya/vite';
 *   export default defineConfig({
 *     plugins: [react(), markupBridge()]
 *   });
 */

export function markupBridge({ port = 3005, host = '127.0.0.1' } = {}) {
  return {
    name: 'vite-plugin-markup-bridge',
    apply: 'serve', // Only inject during local dev server
    transformIndexHtml(html) {
      const scriptTag = `\n    <!-- Markup Bridge for Antigravity -->\n    <script src="http://${host}:${port}/client.js"></script>\n  `;
      if (html.includes('</body>')) {
        return html.replace('</body>', `${scriptTag}</body>`);
      }
      return html + scriptTag;
    }
  };
}
