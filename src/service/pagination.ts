export interface CursorShape {
  created_at: string;
  id: string;
}

export function encodeCursor(cursor: CursorShape): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorShape {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const parsed = JSON.parse(decoded) as Partial<CursorShape>;

  if (typeof parsed.created_at !== "string" || typeof parsed.id !== "string") {
    throw new Error("Invalid cursor");
  }

  return {
    created_at: parsed.created_at,
    id: parsed.id
  };
}
