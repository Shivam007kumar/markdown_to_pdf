/**
 * renderDocument.js
 *
 * Unified markdown-to-HTML pipeline for client-side rendering.
 *
 * Order of operations:
 *   1. Extract mermaid fenced blocks (before code masking, they'd get swallowed)
 *   2. Handle non-mermaid diagram blocks → offline pre fallback
 *   3. Mask remaining fenced code blocks and inline code spans (protects $VAR, $PATH)
 *   4. Extract math expressions ($$, \[, $, \(, etc.) — with currency pre-protection
 *   5. Restore code placeholders into text
 *   6. Run markdown-it
 *   7. DOMPurify sanitize (security boundary — before injecting KaTeX/mermaid HTML)
 *   8. Substitute KaTeX-rendered math back in
 *   9. Inject mermaid container divs
 */

import markdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import katex from 'katex';

// markdown-it instance (singleton; tables are enabled by default in v14+)
const md = markdownIt({ breaks: true, linkify: true, html: true });

// ---------------------------------------------------------------------------
// Step A3: Extract mermaid fenced blocks (must run BEFORE generic code masking)
// ---------------------------------------------------------------------------
const SUPPORTED_OFFLINE_LANGS = ['plantuml', 'd2', 'graphviz', 'excalidraw', 'structurizr'];

function extractMermaid(text) {
  const diagrams = []; // { src: string }
  let count = 0;

  const result = text.replace(/^(`{3,})mermaid[ \t]*\n([\s\S]*?)\n?\1[ \t]*$/gim, (match, _fence, src) => {
    if (count >= 20) {
      // Cap at 20 diagrams — treat the rest as plain code
      return match;
    }
    const idx = diagrams.length;
    diagrams.push({ src: src.trim() });
    count++;
    return `@@MERMAID_${idx}@@`;
  });

  return { result, diagrams };
}

// ---------------------------------------------------------------------------
// Step A4: Non-mermaid diagram blocks → offline fallback (runs before code masking)
// ---------------------------------------------------------------------------
function handleOfflineDiagrams(text) {
  const langPattern = SUPPORTED_OFFLINE_LANGS.join('|');
  const re = new RegExp(
    `^\`{3,}(${langPattern})[ \\t]*\\n([\\s\\S]*?)\\n?\`{3,}[ \\t]*$`,
    'gim'
  );

  return text.replace(re, (_match, lang, src) => {
    const escaped = src
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return (
      `<div class="offline-diagram">` +
      `<p class="offline-diagram-note">Offline preview not available for ${lang}</p>` +
      `<pre><code class="language-${lang}">${escaped}</code></pre>` +
      `</div>`
    );
  });
}

// ---------------------------------------------------------------------------
// Step A2: Mask remaining fenced code blocks and inline code spans
//          (protects $VAR, $PATH, currency in code from math extraction)
// ---------------------------------------------------------------------------
function maskCodeBlocks(text) {
  const store = [];

  // Fenced code blocks (``` or ~~~, with optional language tag)
  let result = text.replace(/^(`{3,}|~{3,})([ \t]*[^\n]*)?\n([\s\S]*?)\n?\1[ \t]*$/gm, (match) => {
    const idx = store.length;
    store.push(match);
    return `@@CODE_${idx}@@`;
  });

  // Multi-backtick inline code spans (e.g. `` `code with backtick` ``)
  result = result.replace(/(`{2,})([^`][\s\S]*?[^`])\1/g, (match) => {
    const idx = store.length;
    store.push(match);
    return `@@CODE_${idx}@@`;
  });

  // Single backtick inline code
  result = result.replace(/`([^`\n]+)`/g, (match) => {
    const idx = store.length;
    store.push(match);
    return `@@CODE_${idx}@@`;
  });

  return { result, store };
}

// ---------------------------------------------------------------------------
// Step A4b: Currency pre-replacement
//           Replaces currency patterns like $5, $10.50, $1,000 with
//           @@CURR_N@@ tokens BEFORE math extraction to prevent false positives.
//           The scanner is left-to-right like extractInlineDollarMath.
// ---------------------------------------------------------------------------

/**
 * Returns true if the content between two $ delimiters looks like math rather
 * than plain currency. Used when the content starts with a digit.
 *
 * Plain currency: only digits, commas, periods — e.g. "5", "10", "15.50", "1,000"
 * Math: contains any LaTeX syntax character — \, ^, _, {, }, =, +, -, *, /, <, >
 *       OR contains a letter (e.g. "$50/month" contains 'm' → math)
 */
function looksLikeMath(content) {
  // If content is ONLY digits, commas, and periods → plain currency
  if (/^[\d,. ]+$/.test(content)) return false;
  // Contains LaTeX syntax characters or letters → treat as math
  return /[\\^_{}\=+\-*/<>a-zA-Z]/.test(content);
}

/**
 * Pre-replaces currency amounts like $5, $10.50, $1,000 with @@CURR_N@@ tokens.
 * Returns { result, currStore } where currStore[N] is the original "$..." text.
 *
 * This runs AFTER code masking (so $PATH in code blocks is already protected)
 * and BEFORE extractMath, ensuring the math scanner never sees currency dollars.
 *
 * A token is treated as currency ONLY when:
 *  - $ is followed by digits (no space)
 *  - The digits (and optional commas/periods) end at a non-math boundary
 *    (whitespace, punctuation like , . ) ] ' " or end of line)
 *  - There is no closing $ on the same line that would make a valid math pair
 *    (i.e. no subsequent $ on the same line after the numeric content)
 *
 * "$2 \cdot L ... $" will NOT be pre-replaced because there's a closing $ later.
 * "$5, " WILL be pre-replaced because there's no closing $ on the same line.
 */
function extractCurrency(text) {
  const currStore = [];

  // Split into lines. On each line, scan for $<digits>[,.digits]* patterns.
  // Only replace a $ if the same line does NOT have a later $ (which would form math).
  const lines = text.split('\n');
  const resultLines = lines.map((line) => {
    return line.replace(/(?<!\\)\$(\d[\d,.]*)/g, (match, digits, offset) => {
      // Check if looksLikeMath could apply — pure digits/commas/periods → definitely currency
      if (looksLikeMath(digits)) return match; // let math scanner handle ($2 \cdot... type)

      // Look for a later $ on the same line (after the end of this match)
      const afterMatch = offset + match.length;
      const restOfLine = line.slice(afterMatch);
      // If there's another $ later on the line, this $N could be the opening of a math pair
      // (e.g. "$2 for $5" — the $2 has a later $ on the same line but doesn't form math).
      // However, we need to guard against "$2 \cdot ... $" being split.
      // The safe heuristic: if the character after the digits is a space and the rest of the
      // line contains a $ that could close a math expression, leave it for the math scanner.
      if (/\$/.test(restOfLine)) {
        // Another $ exists later — let the math scanner decide.
        return match;
      }

      // Safe to replace as currency
      const idx = currStore.length;
      currStore.push(match);
      return `@@CURR_${idx}@@`;
    });
  });

  return { result: resultLines.join('\n'), currStore };
}

/**
 * Left-to-right inline $...$ scanner.
 *
 * Rules:
 *  - Opening $ must not be preceded by \ (escaped dollar)
 *  - Opening $ must not be followed by a space (space after $ = not math)
 *  - Content must be on the same line (no newline between delimiters)
 *  - Closing $ must not be preceded by a space
 *  - Closing $ must not be immediately followed by a digit (e.g. $10 continuation)
 *  - If opening $ is immediately followed by a digit, the content must look like
 *    math (contain \, {, }, ^, _, =, letters, etc.) — otherwise it's currency.
 */
function extractInlineDollarMath(text, store) {
  let result = '';
  let i = 0;
  const n = text.length;

  while (i < n) {
    // Find next unescaped $
    if (text[i] !== '$') {
      result += text[i++];
      continue;
    }

    // Check for escaped dollar (\$)
    const prevChar = i > 0 ? text[i - 1] : '';
    if (prevChar === '\\') {
      result += text[i++];
      continue;
    }

    // Check for display math $$ (already handled before this call, but guard anyway)
    if (i + 1 < n && text[i + 1] === '$') {
      result += text[i++]; // let the $$ pass through (already processed)
      continue;
    }

    // Opening $ found at position i
    const openPos = i;
    const charAfterOpen = i + 1 < n ? text[i + 1] : '';

    // Opening $ followed by space → not math
    if (charAfterOpen === ' ' || charAfterOpen === '\t' || charAfterOpen === '\n' || charAfterOpen === '') {
      result += text[i++];
      continue;
    }

    // Scan for closing $ on the same line
    let j = i + 1;
    let found = false;
    while (j < n && text[j] !== '\n') {
      if (text[j] === '$' && text[j - 1] !== '\\') {
        // Closing $ must not be preceded by space
        const charBeforeClose = text[j - 1];
        if (charBeforeClose === ' ' || charBeforeClose === '\t') {
          j++;
          continue;
        }
        // Closing $ must not be immediately followed by a digit
        const charAfterClose = j + 1 < n ? text[j + 1] : '';
        if (/\d/.test(charAfterClose)) {
          j++;
          continue;
        }
        found = true;
        break;
      }
      j++;
    }

    if (!found) {
      // No valid closing $ on this line → treat as plain text
      result += text[i++];
      continue;
    }

    // We have a candidate: text[openPos+1 .. j-1]
    const content = text.slice(openPos + 1, j);

    // If content starts with a digit, check if it looks like math
    if (/^\d/.test(content)) {
      if (!looksLikeMath(content)) {
        // Plain currency — emit the $ literally and continue from after the $
        result += text[i++];
        continue;
      }
    }

    // It's math — store it
    result += store(content, false);
    i = j + 1; // advance past the closing $
  }

  return result;
}

function extractMath(text) {
  const exprs = []; // { latex: string, display: boolean }

  const store = (latex, display) => {
    const idx = exprs.length;
    exprs.push({ latex, display });
    return `@@MATH_${idx}@@`;
  };

  let result = text;

  // 1. Display math: $$...$$ (must come before inline $)
  result = result.replace(/\$\$([\s\S]*?)\$\$/g, (_m, latex) => store(latex, true));

  // 2. Display math: \[...\] and \\[...\\]
  result = result.replace(/\\{1,2}\[([\s\S]*?)\\{1,2}\]/g, (_m, latex) => store(latex, true));

  // 3. Inline math: \(...\) and \\(...\\)
  result = result.replace(/\\{1,2}\(([\s\S]*?)\\{1,2}\)/g, (_m, latex) => store(latex, false));

  // 4. Inline math: $...$
  //    Use a left-to-right character scanner instead of a blind global regex.
  //    This correctly handles:
  //      - $2 \cdot L \cdot n_{\text{heads}}...$ → math (contains \, {, })
  //      - $B = 1$ → math (contains =)
  //      - $5, $10, $15.50 → plain currency (digits/punctuation only)
  //      - $50/month → math (contains letter 'm')
  result = extractInlineDollarMath(result, store);

  return { result, exprs };
}

// ---------------------------------------------------------------------------
// Steps A6–A9: Full pipeline (synchronous part)
// ---------------------------------------------------------------------------

/**
 * Renders a markdown string to sanitized HTML with KaTeX math rendered inline
 * and mermaid diagrams replaced by container divs for async rendering.
 *
 * @param {string} markdownText
 * @returns {Promise<string>} sanitized HTML
 */
export async function renderDocument(markdownText) {
  if (!markdownText) return '';

  // A3: Extract mermaid blocks first (before generic code masking would swallow them)
  const { result: noMermaid, diagrams: mermaidDiagrams } = extractMermaid(markdownText);

  // A4: Offline diagram fallbacks (before code masking as well)
  const withOfflineDiagrams = handleOfflineDiagrams(noMermaid);

  // A2: Mask remaining code blocks (protects $ in code from math extraction)
  const { result: maskedCode, store: codeStore } = maskCodeBlocks(withOfflineDiagrams);

  // A4b: Pre-replace currency amounts ($5, $10.50, $1,000) with @@CURR_N@@ tokens
  //      so the math scanner never sees them and can't mistake them for math.
  const { result: noCurrency, currStore } = extractCurrency(maskedCode);

  // A5: Extract math expressions
  const { result: noMath, exprs: mathExprs } = extractMath(noCurrency);

  // Restore code placeholders — let markdown-it render them naturally
  let textForMd = noMath;
  textForMd = textForMd.replace(/@@CODE_(\d+)@@/g, (_, idx) => codeStore[+idx]);
  // Restore currency placeholders as plain text
  textForMd = textForMd.replace(/@@CURR_(\d+)@@/g, (_, idx) => currStore[+idx]);

  // A6: markdown-it render
  let rawHtml = md.render(textForMd);

  // A7: DOMPurify sanitize (security boundary — BEFORE inserting KaTeX/mermaid HTML)
  let sanitized;
  if (typeof window !== 'undefined' && window.document) {
    // Browser environment — DOMPurify uses the real DOM
    sanitized = DOMPurify.sanitize(rawHtml, {
      ADD_TAGS: ['math', 'mq-cursor'],
      ADD_ATTR: ['xmlns', 'display', 'mathvariant'],
    });
  } else {
    // Node / test environment — use a JSDOM-backed purify injected via setNodePurify()
    sanitized = _nodePurify
      ? _nodePurify.sanitize(rawHtml, {
          ADD_TAGS: ['math', 'mq-cursor'],
          ADD_ATTR: ['xmlns', 'display', 'mathvariant'],
        })
      : rawHtml;
  }

  // A8: KaTeX substitution (after DOMPurify so KaTeX HTML is never stripped)
  sanitized = sanitized.replace(/@@MATH_(\d+)@@/g, (_, idx) => {
    const { latex, display } = mathExprs[+idx];
    let rendered;
    try {
      rendered = katex.renderToString(latex, { displayMode: display, throwOnError: true });
    } catch (err) {
      const escapedLatex = latex
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      rendered = `<span class="math-error" title="KaTeX error: ${escapedLatex}">${escapedLatex}</span>`;
    }
    return rendered;
  });

  // A9: Mermaid container injection (async rendering happens in renderMermaidDiagrams)
  sanitized = sanitized.replace(/@@MERMAID_(\d+)@@/g, (_, idx) => {
    const escapedSrc = mermaidDiagrams[+idx].src
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
    return `<div class="mermaid-container" data-mermaid-index="${idx}" data-mermaid-src="${escapedSrc}"></div>`;
  });

  return sanitized;
}

// ---------------------------------------------------------------------------
// Node-environment DOMPurify hook (used by test script and SSR)
// ---------------------------------------------------------------------------
let _nodePurify = null;

/**
 * Inject a JSDOM-backed DOMPurify instance for Node / test environments.
 * Call this before renderDocument() in non-browser contexts.
 */
export function setNodePurify(purify) {
  _nodePurify = purify;
}

// ---------------------------------------------------------------------------
// A11: Mermaid async rendering (browser only)
// ---------------------------------------------------------------------------

/** Monotonically increasing counter to generate unique mermaid element IDs */
let _mermaidCounter = 0;

/**
 * Renders all .mermaid-container divs inside containerEl via the local mermaid bundle.
 * Lazy-imports mermaid only when at least one container exists.
 *
 * @param {HTMLElement} containerEl  - Preview root element
 * @param {number}      renderId     - ID assigned at render start
 * @param {() => number} getRenderId - Returns the current (latest) render ID;
 *   used to discard SVG results from stale renders when markdown changes rapidly
 */
export async function renderMermaidDiagrams(containerEl, renderId, getRenderId) {
  const containers = Array.from(containerEl.querySelectorAll('.mermaid-container'));
  if (!containers.length) return;

  // Lazy-load mermaid only when the doc actually has mermaid blocks
  const mermaidModule = await import('mermaid');
  const mermaid = mermaidModule.default;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrors: true,
    theme: 'default',
    flowchart: { padding: 16 },
  });

  // Wait for fonts to load so Mermaid measures text correctly
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  for (const container of containers) {
    // Abort if a newer render has started
    if (getRenderId && getRenderId() !== renderId) return;

    const rawSrc = container.getAttribute('data-mermaid-src') || '';
    const diagramSrc = rawSrc
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

    const uniqueId = `mermaid-diagram-${++_mermaidCounter}`;

    let replacement;
    try {
      // Validate syntax before rendering (parse throws on invalid diagrams)
      await mermaid.parse(diagramSrc);

      // Render with a 5-second timeout
      const { svg } = await Promise.race([
        mermaid.render(uniqueId, diagramSrc),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Mermaid render timeout (5s)')), 5000)
        ),
      ]);

      if (getRenderId && getRenderId() !== renderId) return;

      replacement = svg;
    } catch (err) {
      const escapedSrc = diagramSrc
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const escapedMsg = (err.message || 'Unknown error')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      replacement =
        `<div class="diagram-error">` +
        `Diagram render failed: ${escapedMsg}` +
        `<details><summary>source</summary><pre>${escapedSrc}</pre></details>` +
        `</div>`;
    }

    container.outerHTML = replacement;
  }
}
