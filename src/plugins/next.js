/**
 * Next.js Component for Markup Bridge
 * Safe, zero-config component to include in Next.js RootLayout (App Router)
 * or _app.js (Pages Router).
 * Automatically renders only in development mode.
 *
 * Usage in app/layout.tsx:
 *   import { MarkupBridge } from 'markup-by-kabya/next';
 *   export default function RootLayout({ children }) {
 *     return (
 *       <html>
 *         <body>
 *           {children}
 *           <MarkupBridge />
 *         </body>
 *       </html>
 *     );
 *   }
 */

import React from 'react';

export function MarkupBridge({ port = 3005, host = '127.0.0.1' } = {}) {
  // Only execute in browser and during development
  if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') {
    return null;
  }

  return React.createElement('script', {
    src: `http://${host}:${port}/client.js`,
    async: true
  });
}
