/**
 * test_prose_mask.mjs
 *
 * Unit tests for frontend/src/lib/proseMask.js
 *
 * Run from anywhere:
 *   node /path/to/frontend/tests/test_prose_mask.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// __dirname = frontend/tests
// WORKTREE_ROOT = frontend/tests/../.. = worktree root
const WORKTREE_ROOT = join(__dirname, '../..');
const FIXTURES_DIR = join(WORKTREE_ROOT, 'tests/fixtures');
const PROSE_MASK_MODULE = join(__dirname, '../src/lib/proseMask.js');

// ---------------------------------------------------------------------------
// Import proseMask (ES module)
// ---------------------------------------------------------------------------
const { maskNonProse } = await import(PROSE_MASK_MODULE);

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function pass(name) {
  console.log(`  PASS  ${name}`);
  passed++;
}

function fail(name, detail) {
  console.log(`  FAIL  ${name}`);
  if (detail) console.log(`        ${detail}`);
  failed++;
}

function assert(condition, name, detail) {
  if (condition) pass(name); else fail(name, detail);
}

// ---------------------------------------------------------------------------
// 1. Length invariant & 2. Newline invariant — all 11 fixture files
// ---------------------------------------------------------------------------
console.log('\n── Fixture invariants ──────────────────────────────────────────');

const fixtures = readdirSync(FIXTURES_DIR)
  .filter(f => f.endsWith('.md'))
  .sort();

for (const fname of fixtures) {
  const text = readFileSync(join(FIXTURES_DIR, fname), 'utf8');
  const masked = maskNonProse(text);

  // 1. Length invariant
  assert(
    masked.length === text.length,
    `[length] ${fname}`,
    `expected ${text.length}, got ${masked.length}`
  );

  // 2. Newline invariant
  const inNewlines = (text.match(/\n/g) || []).length;
  const outNewlines = (masked.match(/\n/g) || []).length;
  assert(
    inNewlines === outNewlines,
    `[newlines] ${fname}`,
    `expected ${inNewlines} newlines, got ${outNewlines}`
  );
}

// ---------------------------------------------------------------------------
// 3. Specific token checks
// ---------------------------------------------------------------------------
console.log('\n── Specific token checks ────────────────────────────────────────');

// 3a. Inline code span: `$HADOOP_HOME` → masked (all spaces)
{
  const input = 'Set `$HADOOP_HOME` to the path.';
  const masked = maskNonProse(input);
  const codeStart = input.indexOf('`');
  const codeEnd = input.indexOf('`', codeStart + 1) + 1;
  const codeRegion = masked.slice(codeStart, codeEnd);
  assert(
    /^ +$/.test(codeRegion),
    'Inline code `$HADOOP_HOME` is masked',
    `got: "${codeRegion}"`
  );
  // Prose before/after is preserved
  assert(
    masked.slice(0, codeStart) === input.slice(0, codeStart),
    'Prose before inline code is unchanged'
  );
}

// 3b. \frac{a}{b} inside $...$ → masked to spaces
{
  const input = 'The fraction $\\frac{a}{b}$ is nice.';
  const masked = maskNonProse(input);
  const mathStart = input.indexOf('$');
  const mathEnd = input.lastIndexOf('$') + 1;
  const mathRegion = masked.slice(mathStart, mathEnd);
  assert(
    /^ +$/.test(mathRegion),
    '\\frac{a}{b} inside $...$ is masked',
    `got: "${mathRegion}"`
  );
}

// 3c. Mermaid fenced block → masked to spaces (preserving newlines)
{
  const input = 'Before\n```mermaid\nflowchart TD\n  A --> B\n```\nAfter';
  const masked = maskNonProse(input);
  const fenceStart = input.indexOf('```');
  const fenceEnd = input.lastIndexOf('```') + 3;
  const fenceRegion = masked.slice(fenceStart, fenceEnd);
  // Should be all spaces and newlines
  assert(
    /^[ \n]+$/.test(fenceRegion),
    'Mermaid fenced block is masked (spaces + newlines only)',
    `got: "${fenceRegion.replace(/\n/g, '\\n')}"`
  );
  // Newlines preserved
  const inNL = (input.slice(fenceStart, fenceEnd).match(/\n/g) || []).length;
  const outNL = (fenceRegion.match(/\n/g) || []).length;
  assert(
    inNL === outNL,
    'Mermaid block preserves internal newlines',
    `expected ${inNL}, got ${outNL}`
  );
  // Text after is preserved
  assert(
    masked.slice(fenceEnd) === input.slice(fenceEnd),
    'Text after mermaid block is unchanged'
  );
}

// 3d. URL https://example.com/path → masked to spaces
{
  const input = 'Visit https://example.com/path for details.';
  const masked = maskNonProse(input);
  const urlStart = input.indexOf('https://');
  const urlEnd = input.indexOf(' ', urlStart);
  const urlRegion = masked.slice(urlStart, urlEnd);
  assert(
    /^ +$/.test(urlRegion),
    'URL https://example.com/path is masked',
    `got: "${urlRegion}"`
  );
}

// 3e. Normal prose "The quick brown fox" → NOT masked (stays as-is)
{
  const input = 'The quick brown fox jumps over the lazy dog.';
  const masked = maskNonProse(input);
  assert(
    masked === input,
    'Normal prose is NOT masked (stays as-is)',
    `got: "${masked}"`
  );
}

// ---------------------------------------------------------------------------
// 4. Offset check: "Hello $x^2$ world"
// ---------------------------------------------------------------------------
console.log('\n── Offset check ─────────────────────────────────────────────────');
{
  const input = 'Hello $x^2$ world';
  //             0123456789012345678
  //             Hello = 0-4
  //             space = 5
  //             $x^2$ = 6-10 (5 chars: $ x ^ 2 $)  indices 6..10 inclusive
  //             space = 11
  //             world = 12..16
  const masked = maskNonProse(input);

  // Verify length
  assert(
    masked.length === input.length,
    'Offset check: length invariant',
    `expected ${input.length}, got ${masked.length}`
  );

  // "Hello " preserved
  assert(
    masked.slice(0, 6) === 'Hello ',
    'Offset check: "Hello " preserved',
    `got: "${masked.slice(0, 6)}"`
  );

  // $x^2$ (chars 6–10 inclusive) are spaces
  assert(
    masked[6] === ' ',
    'Offset check: masked[6] === " " (start of $x^2$)',
    `got: "${masked[6]}"`
  );
  assert(
    masked[10] === ' ',
    'Offset check: masked[10] === " " (end of $x^2$)',
    `got: "${masked[10]}"`
  );

  // " world" after the math
  assert(
    masked[11] === ' ',
    'Offset check: masked[11] === " " (space after math)',
    `got: "${masked[11]}"`
  );
  assert(
    masked[12] === 'w',
    'Offset check: masked[12] === "w" (start of "world")',
    `got: "${masked[12]}"`
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const total = passed + failed;
console.log(`\n════════════════════════════════════════════════════════════════`);
console.log(`  ${passed}/${total} checks passed${failed > 0 ? `, ${failed} FAILED` : ' — all good!'}`);
console.log(`════════════════════════════════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
