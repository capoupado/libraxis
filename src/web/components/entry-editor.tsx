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
      <label>
        Title
        <div className="input-group">
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setSubmitError(null);
            }}
          />
          <span className="blinking-cursor" />
        </div>
      </label>

      <label>
        Tags (comma-separated)
        <div className="input-group">
          <input
            value={tagInput}
            onChange={(event) => {
              setTagInput(event.target.value);
              setSubmitError(null);
            }}
          />
          <span className="blinking-cursor" />
        </div>
      </label>

      <label>
        Markdown
        <div className="input-group">
          <textarea
            rows={14}
            value={bodyMarkdown}
            onChange={(event) => {
              setBodyMarkdown(event.target.value);
              setSubmitError(null);
            }}
          />
          <span className="blinking-cursor" />
        </div>
      </label>

      {submitError ? <p role="alert">{submitError}</p> : null}

      <button type="submit" disabled={disabled}>
        {saving ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
