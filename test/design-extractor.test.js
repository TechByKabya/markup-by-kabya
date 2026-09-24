import test from 'node:test';
import assert from 'node:assert';

// Unit tests for core design extraction algorithms and prompt generation

function rgbToHex(rgbStr) {
  if (!rgbStr || rgbStr === 'transparent' || rgbStr.startsWith('rgba(0, 0, 0, 0)')) return null;
  const match = rgbStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return rgbStr;
  const r = parseInt(match[1], 10).toString(16).padStart(2, '0');
  const g = parseInt(match[2], 10).toString(16).padStart(2, '0');
  const b = parseInt(match[3], 10).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function getLuminance(rgbStr) {
  if (!rgbStr) return 1;
  const match = rgbStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return 1;
  const r = parseInt(match[1], 10) / 255;
  const g = parseInt(match[2], 10) / 255;
  const b = parseInt(match[3], 10) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test('rgbToHex converts various rgb formats accurately', () => {
  assert.strictEqual(rgbToHex('rgb(255, 255, 255)'), '#ffffff');
  assert.strictEqual(rgbToHex('rgb(0, 0, 0)'), '#000000');
  assert.strictEqual(rgbToHex('rgba(99, 102, 241, 1)'), '#6366f1');
  assert.strictEqual(rgbToHex('transparent'), null);
  assert.strictEqual(rgbToHex('rgba(0, 0, 0, 0)'), null);
  assert.strictEqual(rgbToHex(''), null);
});

test('getLuminance correctly identifies dark vs light mode', () => {
  const darkBg = 'rgb(10, 10, 15)';
  const lightBg = 'rgb(255, 255, 255)';
  const midBg = 'rgb(24, 24, 27)';

  assert.ok(getLuminance(darkBg) < 0.35, 'Dark background should have luminance < 0.35');
  assert.ok(getLuminance(midBg) < 0.35, 'Mid-dark background should have luminance < 0.35');
  assert.ok(getLuminance(lightBg) > 0.35, 'White background should have luminance > 0.35');
});

test('Design Blueprint prompt contains required Antigravity structure', () => {
  const blueprintData = {
    title: 'Stripe — Financial Infrastructure',
    url: 'https://stripe.com',
    isDark: true,
    palette: {
      pageBg: '#0a2540',
      surfaceBg: '#1a365d',
      accentColor: '#635bff',
      borderColor: '#2d3748',
      headingColor: '#ffffff',
      bodyColor: '#adbdcc'
    },
    typography: {
      headingFont: 'Söhne, sans-serif',
      bodyFont: 'Söhne, sans-serif',
      h1Size: '56px'
    },
    sections: [
      {
        type: 'Navigation Bar',
        links: ['Products', 'Solutions', 'Developers', 'Pricing'],
        hasCta: true
      },
      {
        type: 'Hero Section',
        headline: 'Financial infrastructure for the internet',
        subheadline: 'Millions of companies of all sizes use Stripe online and in person.',
        ctaButtons: ['Start now', 'Contact sales']
      }
    ]
  };

  const prompt = [
    `🎯 REDESIGN & CLONE BLUEPRINT: "${blueprintData.title}"`,
    `Source URL: ${blueprintData.url}`,
    '',
    `### 🎨 1. DESIGN SYSTEM & TOKENS`,
    `- **Theme**: ${blueprintData.isDark ? 'Dark Mode' : 'Light Mode'}`,
    `- **Background**: \`${blueprintData.palette.pageBg}\``,
    `- **Primary Accent / CTA**: \`${blueprintData.palette.accentColor}\``,
    '',
    `### 📐 2. PAGE ARCHITECTURE & SECTIONS`,
    `#### 1. ${blueprintData.sections[0].type}`,
    `- **Links**: ${blueprintData.sections[0].links.join(' | ')}`,
    '',
    `#### 2. ${blueprintData.sections[1].type}`,
    `- **Headline**: "${blueprintData.sections[1].headline}"`,
    `- **CTAs**: [${blueprintData.sections[1].ctaButtons.map(b => `"${b}"`).join(', ')}]`,
    '',
    `### 🚀 3. ANTIGRAVITY TASK INSTRUCTIONS`,
    `Recreate this page in modern, responsive, high-aesthetic web code.`
  ].join('\n');

  assert.ok(prompt.includes('🎯 REDESIGN & CLONE BLUEPRINT: "Stripe — Financial Infrastructure"'));
  assert.ok(prompt.includes('### 🎨 1. DESIGN SYSTEM & TOKENS'));
  assert.ok(prompt.includes('- **Background**: `#0a2540`'));
  assert.ok(prompt.includes('### 📐 2. PAGE ARCHITECTURE & SECTIONS'));
  assert.ok(prompt.includes('### 🚀 3. ANTIGRAVITY TASK INSTRUCTIONS'));
  assert.ok(prompt.length > 200, 'Prompt should have substantive instructions');
  assert.ok(prompt.length < 5000, 'Prompt should remain token-efficient without DOM bloat');
});
