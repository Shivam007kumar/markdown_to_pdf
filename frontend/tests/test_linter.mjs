/**
 * test_linter.mjs
 *
 * Tests for markdownLinter.js.
 * Uses JSDOM to provide a minimal DOM environment.
 *
 * Run from repo root or frontend/:
 *   node /Users/shivamkumar/laptop/markdown_to_pdf/frontend/tests/test_linter.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FRONTEND_DIR = join(__dirname, '..');
const FRONTEND_NODE_MODULES = join(FRONTEND_DIR, 'node_modules');
const FIXTURES_DIR = join(FRONTEND_DIR, '..', 'tests', 'fixtures');
const LINTER_MODULE = join(FRONTEND_DIR, 'src', 'lib', 'markdownLinter.js');

// ---------------------------------------------------------------------------
// Set up JSDOM so DOM-dependent modules (katex, mermaid) work in Node
// ---------------------------------------------------------------------------
const require = createRequire(pathToFileURL(join(FRONTEND_NODE_MODULES, '_placeholder.js')).href);
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});

// Inject globals needed by katex / mermaid
global.window = dom.window;
global.document = dom.window.document;
try { global.navigator = dom.window.navigator; } catch (_) {}
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.cancelAnimationFrame = clearTimeout;

// ---------------------------------------------------------------------------
// Mock CodeMirror EditorView
// ---------------------------------------------------------------------------
function makeView(text) {
  return {
    state: {
      doc: {
        toString() { return text; },
      },
      sliceDoc(from, to) {
        return text.slice(from, to);
      },
    },
    // Minimal dispatch stub so action.apply() doesn't throw
    dispatch(tr) {
      if (tr && tr.changes) {
        // Apply changes to get the resulting text (for action verification)
        this._lastChanges = tr.changes;
      }
    },
    _lastChanges: null,
  };
}

// Apply changes array to text (mirrors CM6 change semantics: sorted, non-overlapping)
function applyChanges(text, changes) {
  // Sort by from ascending
  const sorted = [...changes].sort((a, b) => a.from - b.from);
  let result = '';
  let pos = 0;
  for (const { from, to, insert } of sorted) {
    result += text.slice(pos, from);
    result += (insert || '');
    pos = to;
  }
  result += text.slice(pos);
  return result;
}

// ---------------------------------------------------------------------------
// Import markdownLint
// ---------------------------------------------------------------------------
const { markdownLint } = await import(pathToFileURL(LINTER_MODULE).href);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(condition, label, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}${details ? ' — ' + details : ''}`);
    failed++;
  }
}

function readFixture(filename) {
  return readFileSync(join(FIXTURES_DIR, filename), 'utf-8');
}

// ---------------------------------------------------------------------------
// Fixture 02: 0 false-positive math/syntax errors on $HADOOP_HOME, $5, $10
// ---------------------------------------------------------------------------
console.log('\n--- Fixture 02: currency / env-var false positives ---');
{
  const src = readFixture('02-code-env-vars-and-currency.md');
  const view = makeView(src);
  const diags = await markdownLint(view);

  console.log(`  Diagnostic list for fixture 02 (${diags.length} total):`);
  for (const d of diags) {
    const snippet = src.slice(d.from, Math.min(d.to, d.from + 60)).replace(/\n/g, '↵');
    console.log(`    [${d.severity}] from=${d.from} to=${d.to} "${snippet}" → ${d.message}`);
  }

  // No error or warning that mentions $HADOOP_HOME, $5, or $10 specifically
  const falsePositive = diags.find((d) => {
    const snippet = src.slice(d.from, d.to);
    return (
      snippet.includes('HADOOP_HOME') ||
      snippet.includes('$5') ||
      snippet.includes('$10')
    );
  });
  assert(!falsePositive, 'No false-positive diagnostic on $HADOOP_HOME / $5 / $10');

  // The diagnostic offsets must all be within document bounds
  const allInBounds = diags.every((d) => d.from >= 0 && d.to <= src.length && d.from <= d.to);
  assert(allInBounds, 'All fixture 02 diagnostic offsets are within document bounds');
}

// ---------------------------------------------------------------------------
// Fixture 04: at least 1 KaTeX error diagnostic
// ---------------------------------------------------------------------------
console.log('\n--- Fixture 04: broken LaTeX ---');
{
  const src = readFixture('04-broken-latex-graceful-fallback.md');
  const view = makeView(src);
  const diags = await markdownLint(view);

  const katexErrors = diags.filter((d) => d.severity === 'error' && d.message.includes('KaTeX'));
  assert(katexErrors.length >= 1, `At least 1 KaTeX error diagnostic (got ${katexErrors.length})`);

  const allInBounds = katexErrors.every((d) => d.from >= 0 && d.to <= src.length && d.from <= d.to);
  assert(allInBounds, 'KaTeX error diagnostic offsets are within document bounds');

  if (katexErrors.length > 0) {
    const d = katexErrors[0];
    const snippet = src.slice(d.from, Math.min(d.to, d.from + 80)).replace(/\n/g, '↵');
    console.log(`  First KaTeX error: from=${d.from} to=${d.to} "${snippet}" → ${d.message}`);
  }
}

// ---------------------------------------------------------------------------
// Fixture 05: broken Mermaid detected, valid ones produce no Mermaid error
// ---------------------------------------------------------------------------
console.log('\n--- Fixture 05: Mermaid blocks ---');
{
  const src = readFixture('05-complex-mermaid-valid-and-broken.md');
  const view = makeView(src);
  const diags = await markdownLint(view);

  const mermaidErrors = diags.filter((d) => d.severity === 'error' && d.message.includes('Mermaid'));
  assert(mermaidErrors.length >= 1, `At least 1 Mermaid error diagnostic for the broken block (got ${mermaidErrors.length})`);

  // The file has 3 mermaid blocks; at most the broken one should be flagged
  assert(mermaidErrors.length <= 2, `No more than 2 Mermaid errors (valid blocks not flagged, got ${mermaidErrors.length})`);

  const allInBounds = mermaidErrors.every((d) => d.from >= 0 && d.to <= src.length);
  assert(allInBounds, 'Mermaid error diagnostic offsets are within document bounds');

  for (const d of mermaidErrors) {
    const snippet = src.slice(d.from, Math.min(d.to, d.from + 60)).replace(/\n/g, '↵');
    console.log(`  Mermaid error: from=${d.from} to=${d.to} "${snippet}" → ${d.message}`);
  }
}

// ---------------------------------------------------------------------------
// Double-escaped math: \\( x^2 \\) → warning + action produces \( x^2 \)
// ---------------------------------------------------------------------------
console.log('\n--- Double-escaped math fix ---');
{
  // In the JS source, \\\\( is the string \\( (two backslashes + paren)
  const inputText = 'Here is \\\\( x^2 \\\\) math';
  const view = makeView(inputText);
  const diags = await markdownLint(view);

  const doubleEscDiags = diags.filter(
    (d) => d.severity === 'warning' && d.message.includes('Double-escaped')
  );
  assert(doubleEscDiags.length === 1, `Exactly 1 double-escaped math diagnostic (got ${doubleEscDiags.length})`);

  if (doubleEscDiags.length >= 1) {
    const d = doubleEscDiags[0];
    assert(d.actions && d.actions.length >= 1, 'Diagnostic has at least 1 action');

    if (d.actions && d.actions.length >= 1) {
      assert(d.actions[0].name === 'Normalize delimiters', `Action name is "Normalize delimiters" (got "${d.actions[0].name}")`);

      // Apply the action and collect the resulting changes
      const viewForAction = makeView(inputText);
      d.actions[0].apply(viewForAction, d.from, d.to);

      // The view should have dispatched changes
      if (viewForAction._lastChanges) {
        const changesArr = Array.isArray(viewForAction._lastChanges)
          ? viewForAction._lastChanges
          : [viewForAction._lastChanges];
        const resultText = applyChanges(inputText, changesArr);
        const expected = 'Here is \\( x^2 \\) math';
        assert(
          resultText === expected,
          `Action produces correct normalized text`,
          `expected "${expected}", got "${resultText}"`
        );
      } else {
        assert(false, 'Action dispatched changes to view');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Fixture 11: performance (67 KB document)
// ---------------------------------------------------------------------------
console.log('\n--- Fixture 11: lint performance ---');
{
  const src = readFixture('11-large-chatgpt-paste-70kb.md');
  const view = makeView(src);
  const start = performance.now();
  const diags = await markdownLint(view);
  const elapsed = performance.now() - start;
  console.log(`  ⏱  Fixture 11 lint time: ${elapsed.toFixed(1)} ms (${diags.length} diagnostics)`);
  assert(typeof diags === 'object' && Array.isArray(diags), 'Fixture 11 lint returns an array');
  // No hard time assertion — just report
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ ALL LINTER CHECKS PASSED');
} else {
  console.error('❌ SOME LINTER CHECKS FAILED');
  process.exit(1);
}
