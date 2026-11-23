/**
 * markdownLinter.js
 *
 * CodeMirror 6 linter for Markdown documents.
 * Returns Diagnostic[] for use with @codemirror/lint's linter() extension.
 *
 * Rules:
 *   1. Unclosed fences / display math $$  → severity 'error'
 *   2. ChatGPT double-escaped math \\(...\\) / \\[...\\]  → severity 'warning'
 *   3. Broken LaTeX (KaTeX parse error)  → severity 'error'
 *   4. Broken Mermaid (mermaid.parse error)  → severity 'error'
 *   5. Malformed GFM tables (column-count mismatch)  → severity 'warning'
 *
 * Debounce is applied at the call-site via linter(markdownLint, { delay: 450 }).
 */

import katex from 'katex';

// ---------------------------------------------------------------------------
// Helpers duplicated / imported from renderDocument.js
// (maskCodeBlocks and looksLikeMath are needed here; renderDocument.js does
//  not export them, so we keep local copies that stay in sync with that file.)
// ---------------------------------------------------------------------------

/**
 * Mask fenced code blocks and inline code spans so their contents are not
 * treated as math or table content.
 * Returns { result: string, store: string[], offsets: number[] }
 * where offsets[i] is the character index in the original text at which
 * CODE_BLOCK_i placeholder starts.
 */
function maskCodeBlocks(text) {
  const store = [];
  const offsets = [];

  // Build a parallel "shadow" that tracks where each replacement lands.
  // We work left-to-right so we can compute cumulative length changes.
  //
  // Strategy: collect all matches first, then replace in order, tracking offset drift.

  /**
   * Returns true if the content between two $ delimiters looks like math.
   */

  // Fenced code blocks (``` or ~~~)
  const fencedRe = /^(`{3,}|~{3,})([ \t]*[^\n]*)?\n([\s\S]*?)\n?\1[ \t]*$/gm;
  // Multi-backtick inline spans
  const multiBacktickRe = /(`{2,})([^`][\s\S]*?[^`])\1/g;
  // Single-backtick inline spans
  const singleBacktickRe = /`([^`\n]+)`/g;

  // Collect all matches with their original positions
  const matches = [];

  let m;
  fencedRe.lastIndex = 0;
  while ((m = fencedRe.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  multiBacktickRe.lastIndex = 0;
  while ((m = multiBacktickRe.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  singleBacktickRe.lastIndex = 0;
  while ((m = singleBacktickRe.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
  }

  // Sort by start position, then resolve overlaps (keep first)
  matches.sort((a, b) => a.start - b.start);
  const nonOverlapping = [];
  let lastEnd = 0;
  for (const match of matches) {
    if (match.start >= lastEnd) {
      nonOverlapping.push(match);
      lastEnd = match.end;
    }
  }

  // Build result string and record where each placeholder starts
  let result = '';
  let pos = 0;
  for (const match of nonOverlapping) {
    result += text.slice(pos, match.start);
    const placeholderStart = result.length;
    const placeholder = `CODE_BLOCK_${store.length}`;
    offsets.push(placeholderStart);
    store.push(match.raw);
    result += placeholder;
    pos = match.end;
  }
  result += text.slice(pos);

  return { result, store, offsets };
}

/**
 * Returns true if the content between two $ delimiters looks like math rather
 * than plain currency (mirrors renderDocument.js logic exactly).
 */
function looksLikeMath(content) {
  if (/^[\d,. ]+$/.test(content)) return false;
  return /[\\^_{}\=+\-*/<>a-zA-Z]/.test(content);
}

// ---------------------------------------------------------------------------
// Module-level mermaid initialisation flag
// ---------------------------------------------------------------------------
let _mermaidInitialized = false;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function truncate(str, max) {
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

// ---------------------------------------------------------------------------
// Rule 1: Unclosed fences and unclosed $$ display math
// ---------------------------------------------------------------------------
function checkUnclosedFences(text) {
  const diagnostics = [];
  const lines = text.split('\n');

  let fenceOpen = false;
  let fenceFrom = 0;
  let fenceTo = 0;

  let mathOpen = false;
  let mathFrom = 0;

  let charPos = 0;

  for (const line of lines) {
    const fenceMatch = line.match(/^(`{3,}|~{3,})(\w*)/);

    if (!fenceOpen && !mathOpen) {
      if (fenceMatch) {
        fenceOpen = true;
        fenceFrom = charPos;
        fenceTo = charPos + line.length;
      } else {
        // Scan for $$ in this line (outside fences)
        let idx = 0;
        while (idx < line.length) {
          if (line[idx] === '$' && line[idx + 1] === '$') {
            mathOpen = true;
            mathFrom = charPos + idx;
            idx += 2;
            // Check for immediate closing $$ on the same line
            if (idx < line.length && line[idx] === '$' && line[idx + 1] === '$') {
              mathOpen = false;
              idx += 2;
            }
          } else {
            idx++;
          }
        }
      }
    } else if (fenceOpen) {
      if (fenceMatch && line.trim() !== lines[fenceFrom] && charPos > fenceFrom) {
        // Closing fence: same or more backticks/tildes and no language tag
        const openFenceLine = text.slice(fenceFrom, fenceTo);
        const openChar = openFenceLine[0]; // ` or ~
        const openLen = openFenceLine.match(/^(`+|~+)/)[0].length;
        const closeMatch = line.match(/^(`{3,}|~{3,})[ \t]*$/);
        if (closeMatch && closeMatch[1][0] === openChar && closeMatch[1].length >= openLen) {
          fenceOpen = false;
        }
      }
    } else if (mathOpen) {
      // Look for closing $$ in subsequent lines
      let idx = 0;
      while (idx < line.length) {
        if (line[idx] === '$' && line[idx + 1] === '$') {
          mathOpen = false;
          idx += 2;
          break;
        }
        idx++;
      }
    }

    charPos += line.length + 1; // +1 for the \n
  }

  if (fenceOpen) {
    diagnostics.push({
      from: fenceFrom,
      to: fenceTo,
      severity: 'error',
      message: 'Unclosed fenced code block',
    });
  }

  if (mathOpen) {
    diagnostics.push({
      from: mathFrom,
      to: mathFrom + 2, // just the $$ token
      severity: 'error',
      message: 'Unclosed display math ($$)',
    });
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Rule 2: ChatGPT double-escaped math \\( ... \\) and \\[ ... \\]
// ---------------------------------------------------------------------------
function checkDoubleEscapedMath(maskedText, originalText, maskStore, maskOffsets) {
  const diagnostics = [];

  // Match \\( ... \\) or \\[ ... \\] in the masked text
  // These are literal backslash-backslash sequences
  const re = /\\\\(\()([\s\S]*?)\\\\(\))|(\\\\)(\[)([\s\S]*?)\\\\(\])/g;

  let m;
  while ((m = re.exec(maskedText)) !== null) {
    const matchStart = m.index;
    const matchEnd = m.index + m[0].length;

    // Convert masked-text position to original-text position
    const origFrom = maskedToOrigPos(matchStart, maskedText, maskStore, maskOffsets, originalText);
    const origTo = maskedToOrigPos(matchEnd, maskedText, maskStore, maskOffsets, originalText);

    // Determine which kind
    const isRound = m[1] === '(';
    const inner = isRound ? m[2] : m[6];
    const normalized = isRound ? `\\(${inner}\\)` : `\\[${inner}\\]`;

    diagnostics.push({
      from: origFrom,
      to: origTo,
      severity: 'warning',
      message: `Double-escaped math delimiter — use ${isRound ? '\\( ... \\)' : '\\[ ... \\]'}`,
      actions: [
        {
          name: 'Normalize delimiters',
          apply(view, _from, _to) {
            // Replace ALL double-escaped delimiters in the document
            const docText = view.state.doc.toString();
            const changes = [];
            const globalRe = /\\\\(\([\s\S]*?\\\\[)]|(?:\[)[\s\S]*?\\\\\])/g;
            let gm;
            while ((gm = globalRe.exec(docText)) !== null) {
              const isRoundInner = gm[1].startsWith('(');
              const innerContent = gm[1].slice(1, gm[1].lastIndexOf('\\\\'));
              const replacement = isRoundInner
                ? `\\(${innerContent}\\)`
                : `\\[${innerContent}\\]`;
              changes.push({ from: gm.index, to: gm.index + gm[0].length, insert: replacement });
            }
            if (changes.length > 0) {
              view.dispatch({ changes });
            }
          },
        },
      ],
    });
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Position mapping: masked text → original text
// ---------------------------------------------------------------------------
function maskedToOrigPos(maskedPos, maskedText, maskStore, maskOffsets, originalText) {
  // Find if maskedPos is inside or after a placeholder
  // Placeholders are CODE_BLOCK_N strings in maskedText

  // Walk through placeholders in order of their position in masked text
  let drift = 0; // difference: original_pos = masked_pos + drift

  for (let i = 0; i < maskOffsets.length; i++) {
    const placeholderStart = maskOffsets[i]; // position in maskedText
    const placeholder = `CODE_BLOCK_${i}`;
    const placeholderLen = placeholder.length;
    const originalLen = maskStore[i].length;

    if (maskedPos <= placeholderStart) {
      break; // maskedPos is before this placeholder; drift so far is correct
    }
    // maskedPos is past this placeholder start
    drift += originalLen - placeholderLen;
  }

  return Math.min(maskedPos + drift, originalText.length);
}

// ---------------------------------------------------------------------------
// Rule 3: Broken LaTeX
// ---------------------------------------------------------------------------
function checkBrokenLatex(maskedText, originalText, maskStore, maskOffsets) {
  const diagnostics = [];

  // Extract $$ display math: $$...$$
  const displayRe = /\$\$([\s\S]*?)\$\$/g;
  let m;
  while ((m = displayRe.exec(maskedText)) !== null) {
    const latex = m[1];
    try {
      katex.renderToString(latex, { throwOnError: true });
    } catch (err) {
      const from = maskedToOrigPos(m.index, maskedText, maskStore, maskOffsets, originalText);
      const to = maskedToOrigPos(m.index + m[0].length, maskedText, maskStore, maskOffsets, originalText);
      diagnostics.push({
        from,
        to,
        severity: 'error',
        message: truncate(`KaTeX error: ${err.message}`, 120),
      });
    }
  }

  // Extract \[...\] and \\[...\\] display math
  const displayBracketRe = /\\{1,2}\[([\s\S]*?)\\{1,2}\]/g;
  while ((m = displayBracketRe.exec(maskedText)) !== null) {
    const latex = m[1];
    try {
      katex.renderToString(latex, { throwOnError: true, displayMode: true });
    } catch (err) {
      const from = maskedToOrigPos(m.index, maskedText, maskStore, maskOffsets, originalText);
      const to = maskedToOrigPos(m.index + m[0].length, maskedText, maskStore, maskOffsets, originalText);
      diagnostics.push({
        from,
        to,
        severity: 'error',
        message: truncate(`KaTeX error: ${err.message}`, 120),
      });
    }
  }

  // Extract \(...\) and \\(...\\) inline math
  const inlineParenRe = /\\{1,2}\(([\s\S]*?)\\{1,2}\)/g;
  while ((m = inlineParenRe.exec(maskedText)) !== null) {
    const latex = m[1];
    try {
      katex.renderToString(latex, { throwOnError: true });
    } catch (err) {
      const from = maskedToOrigPos(m.index, maskedText, maskStore, maskOffsets, originalText);
      const to = maskedToOrigPos(m.index + m[0].length, maskedText, maskStore, maskOffsets, originalText);
      diagnostics.push({
        from,
        to,
        severity: 'error',
        message: truncate(`KaTeX error: ${err.message}`, 120),
      });
    }
  }

  // Extract inline $...$ math (using the same scanner as renderDocument.js)
  const inlineMathPositions = extractInlineDollarMathPositions(maskedText);
  for (const { start, end, latex } of inlineMathPositions) {
    try {
      katex.renderToString(latex, { throwOnError: true });
    } catch (err) {
      const from = maskedToOrigPos(start, maskedText, maskStore, maskOffsets, originalText);
      const to = maskedToOrigPos(end, maskedText, maskStore, maskOffsets, originalText);
      diagnostics.push({
        from,
        to,
        severity: 'error',
        message: truncate(`KaTeX error: ${err.message}`, 120),
      });
    }
  }

  return diagnostics;
}

/**
 * Returns array of { start, end, latex } for each inline $...$ math span,
 * applying the same currency-protection logic as renderDocument.js.
 */
function extractInlineDollarMathPositions(text) {
  const results = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    if (text[i] !== '$') { i++; continue; }

    const prevChar = i > 0 ? text[i - 1] : '';
    if (prevChar === '\\') { i++; continue; }

    // Skip $$
    if (i + 1 < n && text[i + 1] === '$') { i++; continue; }

    const openPos = i;
    const charAfterOpen = i + 1 < n ? text[i + 1] : '';

    if (charAfterOpen === ' ' || charAfterOpen === '\t' || charAfterOpen === '\n' || charAfterOpen === '') {
      i++; continue;
    }

    let j = i + 1;
    let found = false;
    while (j < n && text[j] !== '\n') {
      if (text[j] === '$' && text[j - 1] !== '\\') {
        const charBeforeClose = text[j - 1];
        if (charBeforeClose === ' ' || charBeforeClose === '\t') { j++; continue; }
        const charAfterClose = j + 1 < n ? text[j + 1] : '';
        if (/\d/.test(charAfterClose)) { j++; continue; }
        found = true;
        break;
      }
      j++;
    }

    if (!found) { i++; continue; }

    const content = text.slice(openPos + 1, j);
    if (/^\d/.test(content)) {
      if (!looksLikeMath(content)) { i++; continue; }
    }

    results.push({ start: openPos, end: j + 1, latex: content });
    i = j + 1;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Rule 4: Broken Mermaid
// ---------------------------------------------------------------------------
async function checkBrokenMermaid(originalText) {
  const diagnostics = [];

  // Find mermaid fenced blocks in the original text
  const mermaidRe = /^(`{3,})mermaid[ \t]*\n([\s\S]*?)\n?\1[ \t]*$/gim;
  const blocks = [];
  let m;
  while ((m = mermaidRe.exec(originalText)) !== null) {
    blocks.push({
      from: m.index,
      to: m.index + m[0].length,
      src: m[2].trim(),
    });
  }

  if (blocks.length === 0) return diagnostics;

  // Lazy-import mermaid and initialize once
  const mermaidModule = await import('mermaid');
  const mermaid = mermaidModule.default;

  if (!_mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrors: false,
    });
    _mermaidInitialized = true;
  }

  // Run all parse calls in parallel
  const results = await Promise.all(
    blocks.map(async (block) => {
      try {
        await mermaid.parse(block.src);
        return null; // valid
      } catch (err) {
        return {
          from: block.from,
          to: block.to,
          severity: 'error',
          message: truncate(`Mermaid syntax error: ${err.message}`, 120),
        };
      }
    })
  );

  for (const r of results) {
    if (r !== null) diagnostics.push(r);
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Rule 5: Malformed GFM tables
// ---------------------------------------------------------------------------
function checkMalformedTables(maskedText, originalText, maskStore, maskOffsets) {
  const diagnostics = [];
  const lines = maskedText.split('\n');

  // Compute character offset for each line in masked text
  const lineOffsets = [];
  let pos = 0;
  for (const line of lines) {
    lineOffsets.push(pos);
    pos += line.length + 1;
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Check if this line looks like a table header (contains |)
    if (!line.includes('|')) { i++; continue; }

    // Check the next line is a separator row
    const sepLine = lines[i + 1] || '';
    if (!/^\|?[\s:|-]+\|/.test(sepLine)) { i++; continue; }

    // Parse header columns
    const headerCols = countTableCols(line);
    if (headerCols < 2) { i++; continue; }

    // Advance past separator
    i += 2;

    // Check body rows
    while (i < lines.length) {
      const bodyLine = lines[i];
      if (!bodyLine.includes('|')) break; // end of table

      const bodyCols = countTableCols(bodyLine);
      if (bodyCols !== headerCols) {
        const maskedLineStart = lineOffsets[i];
        const maskedLineEnd = maskedLineStart + bodyLine.length;
        const origFrom = maskedToOrigPos(maskedLineStart, maskedText, maskStore, maskOffsets, originalText);
        const origTo = maskedToOrigPos(maskedLineEnd, maskedText, maskStore, maskOffsets, originalText);
        diagnostics.push({
          from: origFrom,
          to: origTo,
          severity: 'warning',
          message: `Table row has ${bodyCols} columns but header has ${headerCols}`,
        });
      }
      i++;
    }
  }

  return diagnostics;
}

function countTableCols(line) {
  // Strip leading/trailing pipes, then split on |
  const stripped = line.replace(/^\|/, '').replace(/\|$/, '');
  return stripped.split('|').length;
}

// ---------------------------------------------------------------------------
// Main exported linter function
// ---------------------------------------------------------------------------
export async function markdownLint(view) {
  const text = view.state.doc.toString();
  if (!text) return [];

  const diagnostics = [];

  // Rule 1: Unclosed fences / $$
  diagnostics.push(...checkUnclosedFences(text));

  // Mask code blocks (protects code content from math/table rules)
  const { result: maskedText, store: maskStore, offsets: maskOffsets } = maskCodeBlocks(text);

  // Rule 2: Double-escaped math (operates on masked text)
  diagnostics.push(...checkDoubleEscapedMath(maskedText, text, maskStore, maskOffsets));

  // Rule 3: Broken LaTeX (operates on masked text)
  diagnostics.push(...checkBrokenLatex(maskedText, text, maskStore, maskOffsets));

  // Rule 4: Broken Mermaid (uses original text to find mermaid blocks)
  try {
    const mermaidDiags = await checkBrokenMermaid(text);
    diagnostics.push(...mermaidDiags);
  } catch (_err) {
    // Mermaid import failure should not surface as an unhandled exception
  }

  // Rule 5: Malformed tables (operates on masked text)
  diagnostics.push(...checkMalformedTables(maskedText, text, maskStore, maskOffsets));

  return diagnostics;
}
