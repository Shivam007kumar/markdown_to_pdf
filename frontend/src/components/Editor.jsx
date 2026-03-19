import React from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';

function Editor({ value, onChange }) {
  return (
    <CodeMirror
      value={value}
      height="100%"
      extensions={[markdown()]}
      onChange={(val) => onChange(val)}
      theme="light"
      className="text-base"
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
      }}
    />
  );
}

export default Editor;
