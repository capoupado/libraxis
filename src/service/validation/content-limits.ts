import { DomainError } from "../errors.js";

export const CONTENT_WARNING_BYTES = 50 * 1024;
export const CONTENT_MAX_BYTES = 500 * 1024;

export interface ContentLimitResult {
  bytes: number;
  warning?: string;
}

export function evaluateContentLimits(markdown: string): ContentLimitResult {
  const bytes = Buffer.byteLength(markdown, "utf8");

  if (bytes > CONTENT_MAX_BYTES) {
    throw new DomainError(
      "CONTENT_LIMIT_EXCEEDED",
      `Content is ${bytes} bytes and exceeds ${CONTENT_MAX_BYTES} bytes`,
      "Reduce content size below 500 KB before retrying."
    );
  }

  if (bytes > CONTENT_WARNING_BYTES) {
    return {
      bytes,
      warning: `Content is ${bytes} bytes; consider splitting large entries.`
    };
  }

  return { bytes };
}
