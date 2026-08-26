import { CodeEditor } from "./code-editor.tsx";

type TextEditorProps = {
  path: string;
};

function TextEditor({ path }: TextEditorProps) {
  return (
    <div className="editor-single">
      <CodeEditor path={path} language={null} />
    </div>
  );
}

export { TextEditor };
