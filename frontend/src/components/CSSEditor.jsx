import React from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { css } from '@codemirror/lang-css';

function CSSEditor({ value, onChange }) {
  return (
    <CodeMirror
      value={value}
      height="100%"
      extensions={[css()]}
      onChange={(val) => onChange(val)}
      theme="light"
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
      }}
    />
  );
}

export default CSSEditor;
