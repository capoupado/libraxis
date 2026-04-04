import matter from "gray-matter";

export interface MarkdownDocument {
  content: string;
  data: Record<string, unknown>;
}

export function parseMarkdown(markdown: string): MarkdownDocument {
  const parsed = matter(markdown);
  return {
    content: parsed.content,
    data: parsed.data
  };
}

export function toMarkdown(content: string, data: Record<string, unknown>): string {
  return matter.stringify(content, data);
}
