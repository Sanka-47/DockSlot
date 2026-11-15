import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const sourceExtensions = new Set(['.ts', '.tsx']);

/**
 * Tailwind silently drops utilities it does not recognise (for example
 * `backdrop-blur-xs` in Tailwind 3). This guard extracts class-like tokens from
 * class-bearing source locations, builds the real Tailwind stylesheet, and
 * fails when a token did not make it into the generated CSS.
 */
const utilityRoots = new Set([
  'absolute',
  'align',
  'animate',
  'antialiased',
  'appearance',
  'aspect',
  'backdrop',
  'basis',
  'bg',
  'block',
  'blur',
  'border',
  'bottom',
  'box',
  'break',
  'brightness',
  'caption',
  'checked',
  'clear',
  'col',
  'collapse',
  'columns',
  'container',
  'content',
  'contents',
  'contrast',
  'cursor',
  'decoration',
  'delay',
  'diagonal',
  'disabled',
  'divide',
  'drop',
  'duration',
  'ease',
  'empty',
  'enabled',
  'fill',
  'fixed',
  'flex',
  'float',
  'flow',
  'font',
  'from',
  'gap',
  'grayscale',
  'grid',
  'group',
  'grow',
  'h',
  'hidden',
  'hue',
  'hyphens',
  'indent',
  'inline',
  'inset',
  'invert',
  'isolate',
  'items',
  'justify',
  'leading',
  'left',
  'line',
  'list',
  'lowercase',
  'marker',
  'max',
  'min',
  'mix',
  'ml',
  'mr',
  'mt',
  'mb',
  'm',
  'mx',
  'my',
  'not',
  'normal',
  'object',
  'opacity',
  'order',
  'ordinal',
  'origin',
  'outline',
  'overflow',
  'overscroll',
  'p',
  'pb',
  'peer',
  'place',
  'pl',
  'pointer',
  'pr',
  'prose',
  'pt',
  'px',
  'py',
  'relative',
  'resize',
  'right',
  'ring',
  'rotate',
  'rounded',
  'row',
  'rtl',
  'ltr',
  'saturate',
  'scale',
  'scroll',
  'select',
  'self',
  'sepia',
  'shadow',
  'shrink',
  'size',
  'skew',
  'slashed',
  'snap',
  'space',
  'sr',
  'static',
  'sticky',
  'stroke',
  'subpixel',
  'supports',
  'table',
  'tabular',
  'text',
  'to',
  'top',
  'touch',
  'tracking',
  'transform',
  'transition',
  'translate',
  'truncate',
  'underline',
  'uppercase',
  'via',
  'visible',
  'w',
  'whitespace',
  'will',
  'z',
  'zoom',
  'fade',
  'slide',
  'spin',
  'ping',
  'pulse',
  'bounce',
]);

const singleUtilityTokens = new Set([
  'absolute',
  'antialiased',
  'block',
  'collapse',
  'container',
  'contents',
  'fixed',
  'flex',
  'grid',
  'grow',
  'hidden',
  'inline',
  'invert',
  'isolate',
  'italic',
  'relative',
  'resize',
  'sepia',
  'shrink',
  'static',
  'sticky',
  'table',
  'transform',
  'truncate',
  'underline',
  'uppercase',
  'visible',
]);

const classBearingVariable =
  /(?:styles?|classes?|classNames?|variants?|sizes?|meta|config|theme)$/i;
const classBearingProperty =
  /^(?:base|bg|text|border|ring|shadow|class|className|style|variant|size|color|tone|badge|status|active|inactive|primary|secondary|outline|ghost|sm|md|lg|danger|success|warning|info)$/i;

function isClassLikeToken(token) {
  if (!token || token.length > 160) return false;
  if (/[\s$`{}"'();,=+@]/.test(token)) return false;

  const withoutVariants = token.split(':').at(-1) ?? token;
  const base = withoutVariants.replace(/^!?-?/, '');
  const rootName = base.split('-')[0]?.split('[')[0] ?? '';

  if (!rootName) return false;
  return utilityRoots.has(rootName) || singleUtilityTokens.has(base);
}

function collectFromText(text, file, position, candidates) {
  for (const rawToken of text.split(/\s+/)) {
    const token = rawToken.trim();
    if (!isClassLikeToken(token)) continue;
    if (!candidates.has(token)) {
      const { line, character } = file.getLineAndCharacterOfPosition(position);
      candidates.set(token, `${path.relative(root, file.fileName)}:${line + 1}:${character + 1}`);
    }
  }
}

function collectExpression(node, file, candidates) {
  if (!node) return;

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    collectFromText(node.text, file, node.getStart(file), candidates);
    return;
  }

  if (ts.isTemplateExpression(node)) {
    collectFromText(node.head.text, file, node.head.getStart(file), candidates);
    for (const span of node.templateSpans) {
      collectFromText(span.literal.text, file, span.literal.getStart(file), candidates);
      collectExpression(span.expression, file, candidates);
    }
    return;
  }

  if (ts.isConditionalExpression(node)) {
    collectExpression(node.whenTrue, file, candidates);
    collectExpression(node.whenFalse, file, candidates);
    return;
  }

  if (ts.isBinaryExpression(node)) {
    collectExpression(node.left, file, candidates);
    collectExpression(node.right, file, candidates);
    return;
  }

  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    collectExpression(node.expression, file, candidates);
    return;
  }

  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) collectExpression(element, file, candidates);
    return;
  }

  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const propertyName = property.name.getText(file).replace(/['"]/g, '');
      if (classBearingProperty.test(propertyName)) {
        collectExpression(property.initializer, file, candidates);
      }
    }
    return;
  }

  if (ts.isCallExpression(node)) {
    for (const argument of node.arguments) collectExpression(argument, file, candidates);
  }
}

function walkFiles(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, onFile);
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      onFile(fullPath);
    }
  }
}

const candidates = new Map();

function scanFile(filePath) {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const file = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === 'className') {
      collectExpression(node.initializer, file, candidates);
    }

    if (ts.isVariableDeclaration(node)) {
      const name = node.name.getText(file);
      if (classBearingVariable.test(name)) {
        collectExpression(node.initializer, file, candidates);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(file);
}

walkFiles(srcRoot, scanFile);

const inputCss = '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n';
const result = await postcss([
  tailwindcss({ config: path.join(root, 'tailwind.config.js') }),
]).process(inputCss, { from: path.join(root, 'src/index.css') });

// Removing CSS escapes makes selectors such as `.sm\:px-6` and
// `.bg-\[\#2F4F4F\]` directly comparable with source tokens.
const generatedCss = result.css.replace(/\\/g, '');

const missing = [];
for (const [token, location] of candidates) {
  const pattern = new RegExp(`\\.${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
  if (!pattern.test(generatedCss)) {
    missing.push({ token, location });
  }
}

if (missing.length > 0) {
  console.error('Tailwind did not generate CSS for these source classes:');
  for (const { token, location } of missing.sort((a, b) => a.token.localeCompare(b.token))) {
    console.error(`  - ${token} (${location})`);
  }
  process.exitCode = 1;
} else {
  console.log(`Tailwind class check passed (${candidates.size} class-like tokens).`);
}
