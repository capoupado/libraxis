import { z } from "zod";

import { relationSchema } from "../../service/validation/schemas.js";

export const validSignals = ["explicit", "tag", "fts"] as const;
export const directionSchema = z.enum(["out", "in", "both"]);
export const signalSchema = z.enum(validSignals);

export function splitCsv(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function parseGraphSignals(raw: string | undefined): Array<(typeof validSignals)[number]> {
  if (raw === undefined) {
    return [...validSignals];
  }

  const parts = splitCsv(raw);
  if (parts.length === 0) {
    return [...validSignals];
  }

  const parsed = z.array(signalSchema).safeParse(parts);
  if (!parsed.success) {
    throw new Error(`Invalid signals. Allowed values: ${validSignals.join(", ")}`);
  }

  return parsed.data;
}

export function parseGraphDirection(raw: string | undefined): "out" | "in" | "both" {
  if (raw === undefined) {
    return "both";
  }

  const parsed = directionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid direction. Allowed values: out, in, both");
  }

  return parsed.data;
}

export function parseGraphRelationTypes(raw: string | undefined): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const parts = splitCsv(raw);
  if (parts.length === 0) {
    return undefined;
  }

  const parsed = z.array(relationSchema).safeParse(parts);
  if (!parsed.success) {
    throw new Error(`Invalid relation_types. Allowed values: ${relationSchema.options.join(", ")}`);
  }

  return parsed.data;
}
