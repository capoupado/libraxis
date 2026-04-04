import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

export interface MarkdownViewProps {
  markdown: string;
}

export function MarkdownView({ markdown }: MarkdownViewProps) {
  const sanitizedHtml = useMemo(() => {
    const unsafe = marked.parse(markdown, { async: false });
    return DOMPurify.sanitize(typeof unsafe === "string" ? unsafe : "");
  }, [markdown]);

  return <article className="markdown-content" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />;
}
