import React, { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { html } from '@codemirror/lang-html';
import { css }  from '@codemirror/lang-css';
import { oneDark } from '@codemirror/theme-one-dark';

interface Props {
  value: string;
  language: 'html' | 'css';
  onChange: (value: string) => void;
  lightTheme?: boolean;
}

const lightThemeExt = EditorView.theme({
  '&': { background: '#ffffff', color: '#1d1d1f' },
  '.cm-content': { caretColor: '#0066cc' },
  '.cm-cursor': { borderLeftColor: '#0066cc' },
  '.cm-gutters': { background: '#f5f5f7', color: '#888', border: 'none' },
  '.cm-activeLineGutter': { background: '#e8e8ed' },
  '.cm-activeLine': { background: '#f0f0f5' },
  '.cm-selectionBackground, ::selection': { background: '#cce0ff !important' },
}, { dark: false });

export const CodeEditor: React.FC<Props> = ({ value, language, onChange, lightTheme }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef      = useRef<EditorView | null>(null);
  // Keep onChange stable so the listener doesn't re-mount
  const onChangeRef  = useRef(onChange);
  onChangeRef.current = onChange;

  // Mount / remount when language changes (parent uses key={tab} to force this)
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          language === 'html' ? html() : css(),
          lightTheme ? lightThemeExt : oneDark,
          EditorView.theme({
            '&': { height: '100%', fontSize: '12px', lineHeight: '1.6' },
            '.cm-scroller': { fontFamily: '"SF Mono", Menlo, monospace', overflow: 'auto' },
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, lightTheme]);

  // Sync external value changes (e.g. Reset button) without remounting
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur !== value) {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    />
  );
};
