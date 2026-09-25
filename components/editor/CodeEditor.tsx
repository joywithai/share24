'use client';

/**
 * Monaco Editor wrapper.
 *
 * Must be loaded with `dynamic(..., { ssr: false })` — Monaco only works in
 * the browser. The heavy `monaco-editor` bundle (and its web workers) is
 * therefore only pulled in on the pages that need it.
 */
import * as monaco from 'monaco-editor';
import { type MutableRefObject, useEffect, useRef } from 'react';

/**
 * Bundle Monaco's web workers with the app (no CDN — the app must work fully
 * self-contained). `new Worker(new URL(...))` is the pattern webpack bundles
 * natively; the subpaths resolve through monaco-editor 0.57's package
 * `exports` map (`monaco-editor/<x>.js` → `esm/vs/<x>.js`).
 */
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new Worker(
          new URL(
            'monaco-editor/language/json/json.worker.js',
            import.meta.url,
          ),
        );
      case 'css':
      case 'scss':
      case 'less':
        return new Worker(
          new URL('monaco-editor/language/css/css.worker.js', import.meta.url),
        );
      case 'html':
      case 'handlebars':
      case 'razor':
        return new Worker(
          new URL(
            'monaco-editor/language/html/html.worker.js',
            import.meta.url,
          ),
        );
      case 'typescript':
      case 'javascript':
        return new Worker(
          new URL(
            'monaco-editor/language/typescript/ts.worker.js',
            import.meta.url,
          ),
        );
      default:
        return new Worker(
          new URL('monaco-editor/editor/editor.worker.js', import.meta.url),
        );
    }
  },
};

const EDITOR_FONT_FAMILY =
  '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

let themeReady = false;
function ensureTheme() {
  if (themeReady) return;
  themeReady = true;
  monaco.editor.defineTheme('sharetofnd', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0b0d0f',
      'editor.foreground': '#e5e7eb',
      'editor.lineHighlightBackground': '#12161b88',
      'editorLineNumber.foreground': '#94a3b84d',
      'editorLineNumber.activeForeground': '#94a3b8',
      'editorCursor.foreground': '#3b82f6',
      'editorIndentGuide.background1': '#1e242d',
      'editorWidget.background': '#12161b',
      'editorWidget.border': '#1e242d',
    },
  });
}

/**
 * Imperative "find in code" handle — the viewer toolbar uses it to highlight
 * matches and glide to them. Matches are always visited in document order, so
 * a word that occurs many times is shown top-first.
 */
export interface CodeEditorApi {
  /** Highlight every match of `query` and smooth-scroll to the first one. */
  find(query: string): { count: number; index: number };
  /** Smooth-scroll to the next match (wraps around at the end). */
  next(): { count: number; index: number };
  /** Drop all highlights. */
  clear(): void;
}

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** Read-only mode (used for viewing shares). */
  readOnly?: boolean;
  /** CSS height for the editor container. */
  height?: string;
  /** Monaco language id. V1 shares are stored as plain text. */
  language?: string;
  ariaLabel?: string;
  /** Filled with the find/next/clear handle while the editor is mounted. */
  apiRef?: MutableRefObject<CodeEditorApi | null>;
}

export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  height = '420px',
  language = 'plaintext',
  ariaLabel = 'Code editor',
  apiRef,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // The value at mount time — the editor is created once and content updates
  // flow through the sync effect below (re-creating on every keystroke would
  // destroy the caret and undo stack).
  const initialValueRef = useRef(value);

  // --- find-in-code state (highlight + smooth scroll) ---------------------
  const matchesRef = useRef<monaco.Range[]>([]);
  const currentRef = useRef(-1);
  const decorationsRef =
    useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  function reveal(index: number) {
    const editor = editorRef.current;
    const range = matchesRef.current[index];
    if (!editor || !range) return;
    editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
  }

  function paint() {
    const editor = editorRef.current;
    if (!editor) return;
    decorationsRef.current ??= editor.createDecorationsCollection([]);
    decorationsRef.current.set(
      matchesRef.current.map((range, i) => ({
        range,
        options: {
          className:
            i === currentRef.current ? 'find-match-current' : 'find-match',
        },
      })),
    );
  }

  function status() {
    return { count: matchesRef.current.length, index: currentRef.current };
  }

  const api: CodeEditorApi = {
    find(query) {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model || !query) {
        api.clear();
        return status();
      }
      // Document order ⇒ the first occurrence in the file comes first.
      const matches = model.findMatches(
        query,
        false,
        /* isRegex */ false,
        /* matchCase */ false,
        /* wordSeparators */ null,
        /* captureMatches */ false,
      );
      matchesRef.current = matches.map((match) => match.range);
      currentRef.current = matches.length > 0 ? 0 : -1;
      paint();
      if (matches.length > 0) reveal(0);
      return status();
    },
    next() {
      const count = matchesRef.current.length;
      if (count === 0) return status();
      currentRef.current = (currentRef.current + 1) % count;
      paint();
      reveal(currentRef.current);
      return status();
    },
    clear() {
      matchesRef.current = [];
      currentRef.current = -1;
      decorationsRef.current?.set([]);
      return status();
    },
  };

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = api;
    return () => {
      apiRef.current = null;
    };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    ensureTheme();
    const editor = monaco.editor.create(container, {
      value: initialValueRef.current,
      language,
      theme: 'sharetofnd',
      fontFamily: EDITOR_FONT_FAMILY,
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      readOnly,
      padding: { top: 14, bottom: 14 },
      renderLineHighlight: 'line',
      // 10px is Monaco's default; the extra 6px keeps a highlight at column 1
      // off the line-number gutter. This must be an editor option — padding
      // the `.view-lines` element from CSS instead moves the text without
      // updating Monaco's layout, which draws the caret (and the find-match
      // highlights) one character to the left of where it belongs.
      lineDecorationsWidth: 16,
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
        // Scroll chaining (important — see below).
        //
        // Monaco's default is `alwaysConsumeMouseWheel: true`, meaning it
        // swallows *every* wheel event over the editor, even when the content
        // already sits at the top or the bottom. The page then refuses to
        // scroll while the pointer is over the box, which traps the visitor:
        // the route/PIN fields and the "Create share" button below become
        // unreachable without first moving the pointer out of the editor.
        //
        // Switching it off means Monaco only consumes the event while it can
        // actually scroll; at either end the browser scrolls the page as
        // usual. This replaces a hand-rolled "does the content fit?" check,
        // which had to guess and got it wrong when the layout changed.
        alwaysConsumeMouseWheel: false,
      },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      contextmenu: !readOnly,
    });
    editorRef.current = editor;

    const subscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue());
    });

    return () => {
      subscription.dispose();
      decorationsRef.current = null;
      editor.dispose();
      editorRef.current = null;
    };
    // The editor is created once per language/read-only mode; content changes
    // flow through the sync effect below.
  }, [language, readOnly]);

  // Keep the model in sync when the controlled value changes from outside
  // (e.g. form reset). Skipped when the values already match, so typing does
  // not fight with the caret.
  //
  // Applied as a regular *edit* rather than `setValue`: `setValue` rebuilds
  // the model, which throws the caret back to the very first line and wipes
  // the undo stack — if a re-render ever lands with a stale value, the visitor
  // sees the caret snap to the top and their typing stops tracking.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    if (model.getValue() === value) return;

    const selection = editor.getSelection();
    model.pushEditOperations(
      [],
      [{ range: model.getFullModelRange(), text: value }],
      () => null,
    );
    // Restore the caret, clamped to the new text (the document may be shorter
    // than it was before the edit).
    if (selection) {
      const line = Math.min(selection.startLineNumber, model.getLineCount());
      const maxColumn = model.getLineMaxColumn(line);
      const startColumn = Math.min(selection.startColumn, maxColumn);
      const endColumn = Math.min(selection.endColumn, maxColumn);
      editor.setSelection(new monaco.Range(line, startColumn, line, endColumn));
    }
  }, [value]);

  return (
    <section
      ref={containerRef}
      aria-label={ariaLabel}
      className="w-full overflow-hidden rounded-lg border border-line bg-bg"
      style={{ height }}
    />
  );
}
