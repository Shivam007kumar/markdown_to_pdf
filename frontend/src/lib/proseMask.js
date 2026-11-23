/**
 * proseMask.js
 *
 * Replaces non-prose regions in a Markdown string with space characters,
 * preserving the exact same string length and newline positions.
 *
 * This ensures that every spell-checker span offset maps 1:1 to the
 * original CodeMirror document positions without any drift.
 *
 * Regions masked (replaced with ' ', keeping '\n'):
 *   1. Fenced code blocks  ``` lang\n...\n``` 
 *   2. Inline code spans   `...`
 *   3. Display math        $$...$$  \[...\]  \\[...\\]
 *   4. Inline math         $...$  \(...\)  \\(...\\)
 *   5. HTML tags           <tag ...>  </tag>
 *   6. URLs                https?://...
 */

// ---------------------------------------------------------------------------
// Helper: replace every char with ' ' except '\n' which stays as '\n'
// ---------------------------------------------------------------------------
function replaceWithSpaces(str) {
  return str.split('').map(ch => ch === '\n' ? '\n' : ' ').join('');
}

// ---------------------------------------------------------------------------
// Currency heuristic (matches renderDocument.js / markdownLinter.js logic)
// ---------------------------------------------------------------------------
function looksLikeMath(content) {
  if (/^[\d,. ]+$/.test(content)) return false;
  return /[\\^_{}\=+\-*/<>a-zA-Z]/.test(content);
}

// ---------------------------------------------------------------------------
// maskNonProse
// ---------------------------------------------------------------------------

/**
 * Returns a string of the exact same length as `text`, with non-prose regions
 * replaced by spaces (preserving newlines).
 *
 * @param {string} text  - Raw markdown text
 * @returns {string}     - Same-length string with non-prose regions blanked
 */
export function maskNonProse(text) {
  // Work on a char array so we can mask in place without changing length.
  const chars = text.split('');

  function maskRange(start, end) {
    for (let i = start; i < end; i++) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  }

  const n = text.length;

  // -------------------------------------------------------------------------
  // 1. Fenced code blocks  ```lang\n...\n```  (and ~~~)
  //    Must run before inline-code so the fences themselves are masked.
  // -------------------------------------------------------------------------
  {
    const fencedRe = /^(`{3,}|~{3,})([ \t]*[^\n]*)?\n([\s\S]*?)\n?\1[ \t]*$/gm;
    let m;
    while ((m = fencedRe.exec(text)) !== null) {
      maskRange(m.index, m.index + m[0].length);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Inline code spans  `...`  and  ``...``
  //    Multi-backtick first (longer match wins), then single-backtick.
  //    We must NOT re-mask already-masked regions — but since maskRange is
  //    idempotent we can just run both regexes sequentially.
  // -------------------------------------------------------------------------
  {
    const multiRe = /(`{2,})([^`][\s\S]*?[^`])\1/g;
    let m;
    while ((m = multiRe.exec(text)) !== null) {
      maskRange(m.index, m.index + m[0].length);
    }
  }
  {
    const singleRe = /`([^`\n]+)`/g;
    let m;
    while ((m = singleRe.exec(text)) !== null) {
      maskRange(m.index, m.index + m[0].length);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Display math  $$...$$
  // -------------------------------------------------------------------------
  {
    const re = /\$\$([\s\S]*?)\$\$/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      maskRange(m.index, m.index + m[0].length);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Display math  \[...\]  and  \\[...\\]
  // -------------------------------------------------------------------------
  {
    const re = /\\{1,2}\[([\s\S]*?)\\{1,2}\]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      maskRange(m.index, m.index + m[0].length);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Inline math  \(...\)  and  \\(...\\)
  // -------------------------------------------------------------------------
  {
    const re = /\\{1,2}\(([\s\S]*?)\\{1,2}\)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      maskRange(m.index, m.index + m[0].length);
    }
  }

  // -------------------------------------------------------------------------
  // 6. Inline math  $...$  — left-to-right scanner with currency protection
  // -------------------------------------------------------------------------
  {
    let i = 0;
    while (i < n) {
      if (text[i] !== '$') { i++; continue; }
      // Skip escaped dollar
      if (i > 0 && text[i - 1] === '\\') { i++; continue; }
      // Skip $$  (already handled above)
      if (i + 1 < n && text[i + 1] === '$') { i += 2; continue; }

      const openPos = i;
      const charAfterOpen = i + 1 < n ? text[i + 1] : '';
      // Opening $ followed by whitespace → not math
      if (charAfterOpen === ' ' || charAfterOpen === '\t' || charAfterOpen === '\n' || charAfterOpen === '') {
        i++; continue;
      }

      // Skip if the region has already been masked (inside a code block)
      if (chars[i] === ' ') { i++; continue; }

      // Scan for closing $ on the same line
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

      // It's math — mask it
      maskRange(openPos, j + 1);
      i = j + 1;
    }
  }

  // -------------------------------------------------------------------------
  // 7. HTML tags  <tag ...>  </tag>
  // -------------------------------------------------------------------------
  {
    const re = /<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?\/?>/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      maskRange(m.index, m.index + m[0].length);
    }
  }

  // -------------------------------------------------------------------------
  // 8. URLs  https?://...
  // -------------------------------------------------------------------------
  {
    const re = /https?:\/\/[^\s)>\]"]+/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      maskRange(m.index, m.index + m[0].length);
    }
  }

  return chars.join('');
}
