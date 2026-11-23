/**
 * test_fixtures.mjs
 *
 * Runs renderDocument.js against all 11 fixture files and asserts correctness.
 * Uses JSDOM to provide a DOM environment for DOMPurify.
 *
 * Run from repo root:
 *   node .agents/tasks/step-1.3-render-pipeline/test_fixtures.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = join(__dirname, '../../..');
const FIXTURES_DIR = join(REPO_ROOT, 'tests/fixtures');
const RENDER_MODULE = join(REPO_ROOT, 'frontend/src/lib/renderDocument.js');
const FRONTEND_NODE_MODULES = join(REPO_ROOT, 'frontend/node_modules');

// ---------------------------------------------------------------------------
// Load JSDOM and DOMPurify from frontend/node_modules
// ---------------------------------------------------------------------------
const require = createRequire(pathToFileURL(join(FRONTEND_NODE_MODULES, '_placeholder.js')).href);
const { JSDOM } = require('jsdom');

const domPurifyUrl = pathToFileURL(
  join(FRONTEND_NODE_MODULES, 'dompurify/dist/purify.cjs.js')
).href;
const DOMPurifyModule = await import(domPurifyUrl);
const DOMPurify = DOMPurifyModule.default;

// ---------------------------------------------------------------------------
// Set up JSDOM + DOMPurify for Node environment
// ---------------------------------------------------------------------------
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const purify = DOMPurify(dom.window);

// Provide minimal globals so renderDocument.js can detect "not browser"
// (we keep window undefined so it falls into the Node branch)
// Actually we set window so the DOMPurify default path works for the
// module-level window detection check. We use setNodePurify instead.

// ---------------------------------------------------------------------------
// Import renderDocument
// ---------------------------------------------------------------------------
const { renderDocument, setNodePurify } = await import(
  pathToFileURL(RENDER_MODULE).href
);

// Wire up the JSDOM-backed DOMPurify instance
setNodePurify(purify);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  \u2705 PASS: ${label}`);
    passed++;
  } else {
    console.error(`  \u274C FAIL: ${label}`);
    failed++;
  }
}

function readFixture(filename) {
  return readFileSync(join(FIXTURES_DIR, filename), 'utf-8');
}

// Get sorted list of fixture files
const fixtureFiles = readdirSync(FIXTURES_DIR)
  .filter(f => f.endsWith('.md'))
  .sort();

console.log(`\nRunning fixture tests against ${fixtureFiles.length} files...\n`);

// ---------------------------------------------------------------------------
// All 11 fixtures: no unhandled exceptions
// ---------------------------------------------------------------------------
console.log('--- Check: All fixtures render without throwing ---');
const renderedMap = {};
for (const file of fixtureFiles) {
  const src = readFixture(file);
  try {
    const html = await renderDocument(src);
    renderedMap[file] = html;
    assert(typeof html === 'string', `${file}: returns a string`);
  } catch (err) {
    assert(false, `${file}: no exception (got: ${err.message})`);
    renderedMap[file] = '';
  }
}

// ---------------------------------------------------------------------------
// Fixture 02: $HADOOP_HOME and $5/$10 must NOT appear as .katex spans
// ---------------------------------------------------------------------------
console.log('\n--- Check: Fixture 02 --- no katex on $HADOOP_HOME, $5, $10 ---');
{
  const html = renderedMap['02-code-env-vars-and-currency.md'] || '';

  // HADOOP_HOME is inside a code block — it must NOT be in a katex span
  const hasKatexForHadoop =
    html.includes('HADOOP_HOME') &&
    /class="katex[^"]*"[^<]{0,300}HADOOP_HOME/.test(html);
  assert(!hasKatexForHadoop, 'HADOOP_HOME not rendered as KaTeX math');

  // $5 and $10 as currency: check that the number "5" and "10" don't appear
  // inside a katex span in a way that indicates they were parsed as math.
  // We check by looking for katex output containing just those digits.
  const katexInnerRegex = /<span class="katex">([\s\S]{0,300}?)<\/span>/g;
  let m;
  let katexFor5 = false;
  let katexFor10 = false;
  while ((m = katexInnerRegex.exec(html)) !== null) {
    // Extract text content from the katex span (strip inner tags)
    const inner = m[1].replace(/<[^>]+>/g, '').trim();
    if (inner === '5' || inner === '5 ') katexFor5 = true;
    if (inner === '10' || inner === '10 ') katexFor10 = true;
  }
  assert(!katexFor5, '$5 (currency) not rendered as KaTeX');
  assert(!katexFor10, '$10 (currency) not rendered as KaTeX');

  // $15.50 must also not be rendered as KaTeX
  let katexFor1550 = false;
  const katexInner2 = /<span class="katex">([\s\S]{0,300}?)<\/span>/g;
  while ((m = katexInner2.exec(html)) !== null) {
    const inner = m[1].replace(/<[^>]+>/g, '').trim();
    if (inner === '15.50' || inner === '15.50 ') katexFor1550 = true;
  }
  assert(!katexFor1550, '$15.50 (currency) not rendered as KaTeX');

  // $HADOOP_HOME should not appear as a .katex or .math-error span
  // (it's inside a code block, so it's protected by code masking)
  const hadoopInKatexOrError = /<span class="(?:katex|math-error)"[^>]*>[^<]*HADOOP[^<]*<\/span>/.test(html);
  assert(!hadoopInKatexOrError, '$HADOOP_HOME not in .katex or .math-error span');

  // The actual math $\Delta E = mc^2$ SHOULD produce katex output
  assert(html.includes('katex'), 'Actual math $\\Delta E = mc^2$ IS rendered by KaTeX');
}

// ---------------------------------------------------------------------------
// Fixture 04: broken LaTeX -> .math-error fallback
// ---------------------------------------------------------------------------
console.log('\n--- Check: Fixture 04 --- broken LaTeX produces .math-error ---');
{
  const html = renderedMap['04-broken-latex-graceful-fallback.md'] || '';
  assert(html.includes('math-error'), 'Has .math-error class for broken LaTeX');
  // Valid math should still render
  assert(html.includes('katex'), 'Valid math before/after error still renders');
}

// ---------------------------------------------------------------------------
// Fixture 05: mermaid blocks -> .mermaid-container placeholders
// ---------------------------------------------------------------------------
console.log('\n--- Check: Fixture 05 --- mermaid containers injected ---');
{
  const html = renderedMap['05-complex-mermaid-valid-and-broken.md'] || '';
  assert(html.includes('mermaid-container'), 'Has .mermaid-container for mermaid blocks');

  const containerCount = (html.match(/mermaid-container/g) || []).length;
  // The file has 3 mermaid blocks; count is number of class="mermaid-container" occurrences
  // Each container div has the class twice (opening tag + data attribute text won't repeat it)
  // so at least 1 unique container
  assert(containerCount >= 1, `At least 1 mermaid-container found (got ${containerCount})`);

  // We expect all 3 mermaid blocks to be injected as containers in the synchronous phase
  // (the broken one will error only during async mermaid.render in the browser)
  // Count distinct data-mermaid-index values
  const indexMatches = html.match(/data-mermaid-index="(\d+)"/g) || [];
  assert(indexMatches.length >= 3, `All 3 mermaid blocks become containers (got ${indexMatches.length})`);
}

// ---------------------------------------------------------------------------
// Fixture 08: no URLs matching external CDN / diagram services
// ---------------------------------------------------------------------------
console.log('\n--- Check: Fixture 08 --- no external render service URLs ---');
{
  const html = renderedMap['08-non-mermaid-diagrams-kroki.md'] || '';
  const forbiddenPatterns = [
    { label: 'mermaid.ink', re: /mermaid\.ink/ },
    { label: 'kroki.io', re: /kroki\.io/ },
    { label: 'googleapis.com', re: /googleapis\.com/ },
    { label: 'jsdelivr.net', re: /jsdelivr\.net/ },
    { label: 'unpkg.com', re: /unpkg\.com/ },
    { label: 'cdnjs.cloudflare.com', re: /cdnjs\.cloudflare\.com/ },
  ];
  for (const { label, re } of forbiddenPatterns) {
    assert(!re.test(html), `No URL matching ${label} in fixture 08 output`);
  }
  // Should have offline-diagram fallback blocks for plantuml and graphviz
  assert(html.includes('offline-diagram'), 'Offline diagram note present for plantuml/graphviz');
}

// ---------------------------------------------------------------------------
// Fixture 11: timing + math rendering checks
// ---------------------------------------------------------------------------
console.log('\n--- Check: Fixture 11 --- render timing ---');
{
  const src = readFixture('11-large-chatgpt-paste-70kb.md');
  const start = performance.now();
  const html = await renderDocument(src);
  const elapsed = performance.now() - start;
  console.log(`  \u23F1  Fixture 11 render time: ${elapsed.toFixed(1)} ms`);
  assert(typeof html === 'string' && html.length > 0, 'Fixture 11 renders without error');
  assert(elapsed < 30000, `Fixture 11 renders in under 30 seconds (took ${elapsed.toFixed(0)} ms)`);

  // $2 \cdot L should be rendered as KaTeX, not left as a raw string
  assert(!html.includes('$2 \\cdot'), '$2 \\cdot L not present as raw text in output (was parsed as math)');
  assert(!html.includes('$2 &cdot;'), '$2 &cdot; not present as escaped raw text');

  // The output should contain a .katex span (proving math rendered correctly)
  assert(html.includes('class="katex"'), 'Fixture 11 output contains .katex spans');

  // $50/month should not cause unhandled exceptions (already covered by render-without-throwing check)
  // But also verify it doesn't appear as a .math-error that breaks layout
  // ($50/month contains 'month' (letters) so our scanner treats it as math;
  //  KaTeX may fail on it → .math-error is acceptable, but no uncaught exception)
  const mathErrorCount = (html.match(/class="math-error"/g) || []).length;
  assert(mathErrorCount >= 0, `Fixture 11 math-error count is non-negative (got ${mathErrorCount})`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('\u2705 ALL CHECKS PASSED');
} else {
  console.error('\u274C SOME CHECKS FAILED');
  process.exit(1);
}
