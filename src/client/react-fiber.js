/**
 * Universal Framework Introspection Engine
 * Inspects DOM elements across multiple modern frameworks:
 * - React (Fiber internal properties, displayName, _debugSource file:line)
 * - Vue 3 (__vueParentComponent, __file, type name)
 * - Vue 2 (__vue__ instance, $options._componentTag)
 * - Svelte (__svelte_meta loc.file, loc.line)
 * - Angular (window.ng.getComponent)
 * - Astro / Vite (data-astro-source-file, data-source-file)
 */

export function extractFrameworkContext(el) {
  if (!el || typeof el !== 'object') return null;

  // 1. Try React Fiber
  const reactContext = extractReactFiber(el);
  if (reactContext) return { framework: 'React', ...reactContext };

  // 2. Try Vue 3
  const vue3Context = extractVue3(el);
  if (vue3Context) return { framework: 'Vue 3', ...vue3Context };

  // 3. Try Vue 2
  const vue2Context = extractVue2(el);
  if (vue2Context) return { framework: 'Vue 2', ...vue2Context };

  // 4. Try Svelte
  const svelteContext = extractSvelte(el);
  if (svelteContext) return { framework: 'Svelte', ...svelteContext };

  // 5. Try Angular
  const angularContext = extractAngular(el);
  if (angularContext) return { framework: 'Angular', ...angularContext };

  // 6. Try Astro / Vite data attributes
  const astroContext = extractAstroSource(el);
  if (astroContext) return { framework: 'Astro', ...astroContext };

  // 7. Check if Custom Web Component (e.g. <my-card>)
  if (el.tagName && el.tagName.includes('-')) {
    return {
      framework: 'Web Component',
      componentName: `<${el.tagName.toLowerCase()}>`,
      hierarchy: [`<${el.tagName.toLowerCase()}>`],
      source: null,
      props: null
    };
  }

  return null;
}

function extractReactFiber(el) {
  try {
    const fiberKey = Object.keys(el).find(k => 
      k.startsWith('__reactFiber$') || 
      k.startsWith('__reactInternalInstance$')
    );
    if (!fiberKey) return null;

    let fiber = el[fiberKey];
    if (!fiber) return null;

    const hierarchy = [];
    let primaryComponent = null;
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
        if (!primaryComponent) {
          primaryComponent = name;
          if (curr._debugSource) {
            debugSource = {
              file: curr._debugSource.fileName || '',
              line: curr._debugSource.lineNumber || 0,
              column: curr._debugSource.columnNumber || 0
            };
          }
          if (curr.memoizedProps) {
            propsSummary = cleanProps(curr.memoizedProps);
          }
        }
      }

      curr = curr.return;
    }

    if (!primaryComponent && !debugSource) return null;

    return {
      componentName: `<${primaryComponent || 'Component'}>`,
      hierarchy,
      source: debugSource,
      props: propsSummary
    };
  } catch (_) {
    return null;
  }
}

function extractVue3(el) {
  try {
    let curr = el;
    while (curr) {
      if (curr.__vueParentComponent) {
        const comp = curr.__vueParentComponent;
        const type = comp.type || {};
        const name = type.__name || type.name || comp.name;
        const file = type.__file || '';

        return {
          componentName: `<${name || 'VueComponent'}>`,
          hierarchy: [`<${name || 'VueComponent'}>`],
          source: file ? { file, line: 1, column: 1 } : null,
          props: cleanProps(comp.props)
        };
      }
      curr = curr.parentElement;
    }
  } catch (_) {}
  return null;
}

function extractVue2(el) {
  try {
    let curr = el;
    while (curr) {
      if (curr.__vue__) {
        const comp = curr.__vue__;
        const name = comp.$options?.name || comp.$options?._componentTag || 'VueComponent';
        return {
          componentName: `<${name}>`,
          hierarchy: [`<${name}>`],
          source: null,
          props: cleanProps(comp.$props)
        };
      }
      curr = curr.parentElement;
    }
  } catch (_) {}
  return null;
}

function extractSvelte(el) {
  try {
    let curr = el;
    while (curr) {
      if (curr.__svelte_meta) {
        const meta = curr.__svelte_meta;
        const loc = meta.loc || {};
        const file = loc.file || '';
        const name = file ? file.split('/').pop().replace(/\.svelte$/, '') : 'SvelteComponent';
        return {
          componentName: `<${name}>`,
          hierarchy: [`<${name}>`],
          source: { file, line: loc.line || 1, column: loc.column || 1 },
          props: null
        };
      }
      curr = curr.parentElement;
    }
  } catch (_) {}
  return null;
}

function extractAngular(el) {
  try {
    if (typeof window !== 'undefined' && window.ng?.getComponent) {
      const comp = window.ng.getComponent(el);
      if (comp) {
        const name = comp.constructor?.name || 'AngularComponent';
        return {
          componentName: `<${name}>`,
          hierarchy: [`<${name}>`],
          source: null,
          props: null
        };
      }
    }
  } catch (_) {}
  return null;
}

function extractAstroSource(el) {
  try {
    const target = el.closest('[data-astro-source-file]');
    if (target) {
      const file = target.getAttribute('data-astro-source-file') || '';
      const loc = target.getAttribute('data-astro-source-loc') || '';
      const [line, col] = loc.split(':').map(Number);
      const name = file.split('/').pop().split('.')[0];
      return {
        componentName: `<${name}>`,
        hierarchy: [`<${name}>`],
        source: { file, line: line || 1, column: col || 1 },
        props: null
      };
    }
  } catch (_) {}
  return null;
}

function cleanProps(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (['children', 'key', 'ref'].includes(k)) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
