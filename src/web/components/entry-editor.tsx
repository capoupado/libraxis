import { useEffect, useMemo, useState } from "react";

import { getErrorMessage } from "../lib/http-client.js";

export interface EntryEditorProps {
  initialTitle?: string;
  initialBody?: string;
  initialTags?: string[];
  submitLabel?: string;
  onSubmit: (payload: { title: string; body_markdown: string; tags: string[] }) => Promise<void>;
}

export function EntryEditor({
  initialTitle = "",
  initialBody = "",
  initialTags = [],
  submitLabel = "Save Entry",
  onSubmit
}: EntryEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [bodyMarkdown, setBodyMarkdown] = useState(initialBody);
  const initialTagInput = initialTags.join(", ");
  const [tagInput, setTagInput] = useState(initialTagInput);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle]);

  useEffect(() => {
    setBodyMarkdown(initialBody);
  }, [initialBody]);

  useEffect(() => {
    setTagInput(initialTagInput);
  }, [initialTagInput]);

  const tags = useMemo(
    () =>
      Array.from(
        new Set(
          tagInput
            .split(",")
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean)
        )
      ),
    [tagInput]
  );

  const disabled = saving || title.trim().length === 0 || bodyMarkdown.trim().length === 0;

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setSubmitError(null);
        try {
          await onSubmit({
            title: title.trim(),
            body_markdown: bodyMarkdown,
            tags
          });
        } catch (error) {
          setSubmitError(getErrorMessage(error, "Failed to save entry."));
        } finally {
          setSaving(false);
        }
      }}
    >
      <label className="cyber-label"><span className="dot"></span> Title</label>
      <div className="cyber-input">
        <span className="cyber-input__prefix">&gt;</span>
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setSubmitError(null);
          }}
        />
      </div>

      <label className="cyber-label"><span className="dot"></span> Tags (comma-separated)</label>
      <div className="cyber-input">
        <span className="cyber-input__prefix">&gt;</span>
        <input
          value={tagInput}
          onChange={(event) => {
            setTagInput(event.target.value);
            setSubmitError(null);
          }}
        />
      </div>

      <label className="cyber-label"><span className="dot"></span> Markdown</label>
      <div className="cyber-input cyber-input--area">
        <span className="cyber-input__prefix">&gt;</span>
        <textarea
          rows={14}
          value={bodyMarkdown}
          onChange={(event) => {
            setBodyMarkdown(event.target.value);
            setSubmitError(null);
          }}
        />
      </div>

      {submitError ? <p role="alert">{submitError}</p> : null}

      <button type="submit" className="cyber-btn cyber-btn--glitch" disabled={disabled}>
        {saving ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
