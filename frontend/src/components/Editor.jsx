import React from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';

function Editor({ value, onChange, onImageAdded }) {
  const handleImageFile = (file, view, pos) => {
    if (!file || !file.type.startsWith('image/')) return;
    
    // Create base64 encoding to send to backend, but a quick blob for the frontend preview
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
        extensions={[markdown(), domHandlers, EditorView.lineWrapping]}
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
