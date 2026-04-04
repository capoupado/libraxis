export type ErrorCode =
  | "INVALID_INPUT"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "ENTRY_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "SKILL_REFERENCE_INVALID"
  | "PROPOSAL_NOT_FOUND"
  | "PROPOSAL_STATE_INVALID"
  | "CONTENT_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR"
  | "SKILL_UPDATE_REQUIRES_PROPOSAL";

export class DomainError extends Error {
  public readonly code: ErrorCode;

  public readonly suggestion?: string;

  public constructor(code: ErrorCode, message: string, suggestion?: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.suggestion = suggestion;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
