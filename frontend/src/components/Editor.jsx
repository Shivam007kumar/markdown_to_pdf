import React, { useRef, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
import { linter, lintGutter } from '@codemirror/lint';
import { markdownLint } from '../lib/markdownLinter';
import { runSpellcheck } from '../lib/spellcheckLinter';
import { maskNonProse } from '../lib/proseMask';

// Compartment for dynamically toggling the spellcheck extension
const spellcheckCompartment = new Compartment();

function buildSpellcheckExtension(enabled) {
  if (!enabled) return [];
  return linter(async (view) => {
    const text = view.state.doc.toString();
    if (text.length > 150000) return [];
    const masked = maskNonProse(text);
    let harperDiags;
    try {
      harperDiags = await runSpellcheck(masked);
    } catch (_err) {
      return [];
    }
    return harperDiags.map((d) => ({
      from: d.span.start,
      to: d.span.end,
      severity: 'info',
      message: d.message,
      actions: d.suggestions.map((s) => ({
        name: s,
        apply(view, from, to) {
          view.dispatch({ changes: { from, to, insert: s } });
        },
      })),
    }));
  }, { delay: 700 });
}

function Editor({ value, onChange, onImageAdded, onHasDoubleEscapedMath, spellcheckEnabled }) {
  const lastDiagsRef = useRef([]);
  const spellcheckEnabledRef = useRef(spellcheckEnabled);
  const viewRef = useRef(null);

  // When spellcheckEnabled prop changes, reconfigure the compartment
  const prevSpellcheckRef = useRef(spellcheckEnabled);
  if (prevSpellcheckRef.current !== spellcheckEnabled) {
    prevSpellcheckRef.current = spellcheckEnabled;
    spellcheckEnabledRef.current = spellcheckEnabled;
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: spellcheckCompartment.reconfigure(buildSpellcheckExtension(spellcheckEnabled)),
      });
    }
  }

  const handleImageFile = (file, view, pos) => {
    if (!file || !file.type.startsWith('image/')) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result;
      const blobUrl = URL.createObjectURL(file);
      
      if (onImageAdded) {
        onImageAdded(blobUrl, base64);
      }
      
      const insertText = `\n![image](${blobUrl})\n`;
      view.dispatch({
        changes: { from: pos, to: pos, insert: insertText },
        selection: { anchor: pos + insertText.length }
      });
    };
    reader.readAsDataURL(file);
  };

  // Linter wrapper that also notifies parent about double-escaped math warnings
  const linterWithCallback = useCallback((view) => {
    return markdownLint(view).then((diags) => {
      lastDiagsRef.current = diags;
      const hasDoubleEscaped = diags.some(
        (d) => d.severity === 'warning' && d.message.includes('Double-escaped')
      );
      if (onHasDoubleEscapedMath) {
        onHasDoubleEscapedMath(hasDoubleEscaped);
      }
      return diags;
    });
  }, [onHasDoubleEscapedMath]);

  const domHandlers = EditorView.domEventHandlers({
    paste(event, view) {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return false;
      const items = clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          handleImageFile(file, view, view.state.selection.main.head);
          event.preventDefault();
          return true;
        }
      }
      return false;
    },
    drop(event, view) {
      if (event.dataTransfer && event.dataTransfer.files) {
        const files = event.dataTransfer.files;
        for (let i = 0; i < files.length; i++) {
          if (files[i].type.startsWith('image/')) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos !== null) {
              handleImageFile(files[i], view, pos);
              event.preventDefault();
              return true;
            }
          }
        }
      }
      return false;
    }
  });

  return (
    <div className="h-full w-full bg-white flex justify-center">
      <CodeMirror
        value={value}
        height="100%"
        extensions={[
          markdown(),
          domHandlers,
          EditorView.lineWrapping,
          lintGutter(),
          linter(linterWithCallback, { delay: 450 }),
          spellcheckCompartment.of(buildSpellcheckExtension(spellcheckEnabled !== false)),
        ]}
        onCreateEditor={(view) => {
          viewRef.current = view;
        }}
        onChange={(val) => onChange(val)}
        theme="light"
        className="text-base w-full max-w-4xl px-2 sm:px-4 md:px-8 pb-12"
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
        }}
      />
    </div>
  );
}

export default Editor;
