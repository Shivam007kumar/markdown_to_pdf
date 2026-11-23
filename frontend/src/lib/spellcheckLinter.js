/**
 * spellcheckLinter.js
 *
 * Wraps harper.js WorkerLinter with:
 *   - binaryInlined (zero external WASM fetch — Vite bundles it inline)
 *   - 700 ms debounce managed at the call-site (see Editor.jsx)
 *   - Stale-result cancellation via a monotonic request ID
 *   - >150 KB guard (skip linting for very large docs)
 *
 * Uses Option A: WorkerLinter, which manages its own worker thread internally.
 * We use binaryInlined so the WASM is bundled as a data URL — no CDN fetches.
 */

import { WorkerLinter } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';

let _linter = null;

function getLinter() {
  if (!_linter) {
    _linter = new WorkerLinter({ binary: binaryInlined });
  }
  return _linter;
}

let _latestId = 0;

/**
 * Lint `text` with Harper using the inlined WASM binary.
 *
 * Returns an array of plain objects:
 *   { span: { start, end }, message, suggestions: string[] }
 *
 * Returns [] immediately if text is > 150 KB.
 * Drops the result if a newer request arrives while this one was in flight.
 *
 * @param {string} text  - Prose-masked markdown text (same length as the doc)
 * @returns {Promise<Array<{span:{start:number,end:number}, message:string, suggestions:string[]}>>}
 */
export async function runSpellcheck(text) {
  if (!text || text.length > 150000) return [];

  const myId = ++_latestId;

  let lints;
  try {
    lints = await getLinter().lint(text, { language: 'markdown' });
  } catch (_err) {
    return [];
  }

  // Stale cancellation
  if (myId !== _latestId) return [];

  return lints.map((lint) => {
    const span = lint.span();
    const suggestions = [];
    const count = lint.suggestion_count();
    for (let i = 0; i < count; i++) {
      const s = lint.suggestions()[i];
      suggestions.push(s.get_replacement_text());
    }
    return {
      span: { start: span.start, end: span.end },
      message: lint.message(),
      suggestions,
    };
  });
}

/**
 * Dispose the WorkerLinter instance and terminate its underlying worker.
 * Safe to call even if the linter was never initialized.
 */
export async function disposeSpellcheckLinter() {
  if (_linter) {
    try {
      await _linter.dispose();
    } catch (_) {
      // Ignore errors during disposal
    }
    _linter = null;
  }
}
