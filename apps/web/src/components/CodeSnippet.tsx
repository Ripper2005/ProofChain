import { useState } from "react";

export function CodeSnippet({
  label,
  code,
  testId,
}: {
  label: string;
  code: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="muted">{label}</span>
        <button type="button" className="secondary compact" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy command"}
        </button>
      </div>
      <pre className="cast" data-testid={testId}>
        {code}
      </pre>
    </div>
  );
}
