/**
 * Generates a unique, minimal CSS selector path for a target DOM element.
 * Example: #main-content > div.card:nth-child(2) > button.btn-primary
 */
export function getUniqueSelector(el) {
  if (!(el instanceof Element)) return '';
  if (el.nodeType !== Node.ELEMENT_NODE) return '';

  // 1. If element has a valid unique ID on the page
  if (el.id && isValidId(el.id)) {
    const idSelector = `#${CSS.escape(el.id)}`;
    try {
      if (document.querySelectorAll(idSelector).length === 1) {
        return idSelector;
      }
    } catch (_) {}
  }

  // 2. If element has data-testid or data-test that is unique
  for (const attr of ['data-testid', 'data-test', 'data-cy']) {
    const val = el.getAttribute(attr);
    if (val) {
      const testSelector = `[${attr}="${CSS.escape(val)}"]`;
      try {
        if (document.querySelectorAll(testSelector).length === 1) {
          return testSelector;
        }
      } catch (_) {}
    }
  }

  // 3. Build step-by-step path upward
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

    let selector = getNodeSelector(curr);

    // If this node has a unique ID, we can stop climbing
    if (curr.id && isValidId(curr.id)) {
      const idSelector = `#${CSS.escape(curr.id)}`;
      try {
        if (document.querySelectorAll(idSelector).length === 1) {
          path.unshift(idSelector);
          break;
        }
      } catch (_) {}
    }

    path.unshift(selector);

    // Check if the current partial path is uniquely identifying the element
    const fullSelector = path.join(' > ');
    try {
      const matches = document.querySelectorAll(fullSelector);
      if (matches.length === 1 && matches[0] === el) {
        return fullSelector;
      }
    } catch (_) {}

    curr = curr.parentElement;
  }

  const finalSelector = path.join(' > ');
  return finalSelector;
}

function isValidId(id) {
  if (!id || typeof id !== 'string') return false;
  // Ignore purely numerical or auto-generated React IDs like ":r1:"
  if (/^:r[0-9a-zA-Z]+:$/.test(id)) return false;
  if (/^[0-9]/.test(id)) return false;
  return true;
}

function getNodeSelector(el) {
  let tag = el.tagName.toLowerCase();
  
  // Collect useful non-utility class names
  const classes = Array.from(el.classList || [])
    .filter(cls => {
      // Exclude bridge internal classes and unstable auto-generated hash classes
      if (cls.startsWith('__ag_') || cls.startsWith('ag-')) return false;
      if (/^[a-zA-Z0-9_-]{2,30}$/.test(cls) && !cls.includes(':') && !cls.includes('[')) {
        return true;
      }
      return false;
    })
    .slice(0, 2);

  let classPart = classes.length > 0 ? '.' + classes.map(c => CSS.escape(c)).join('.') : '';
  let baseSelector = `${tag}${classPart}`;

  // If parent exists, compute nth-child or nth-of-type if siblings share same selector
  if (el.parentElement) {
    const siblings = Array.from(el.parentElement.children);
    const sameTagSiblings = siblings.filter(s => s.tagName === el.tagName);

    if (sameTagSiblings.length > 1) {
      const index = siblings.indexOf(el) + 1;
      baseSelector += `:nth-child(${index})`;
    }
  }

  return baseSelector;
}
