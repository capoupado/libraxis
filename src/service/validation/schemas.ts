import { z, type ZodType } from "zod";

import { DomainError } from "../errors.js";

export const entryTypeSchema = z.enum(["prompt", "run", "mistake", "lesson", "note", "skill"]);
export const writableEntryTypeSchema = z.enum(["prompt", "mistake", "lesson", "note", "skill"]);
export const apiKeyScopeSchema = z.enum(["read", "write", "admin"]);

export const tagAllowlistPattern = /^[a-z0-9_-]+$/;
export const tagInputSchema = z.string().trim().min(1).max(64);
export const normalizedTagSchema = tagInputSchema
  .transform((value) => value.toLowerCase())
  .refine((value) => tagAllowlistPattern.test(value), {
    message: "Tags may only contain lowercase letters, numbers, hyphen, and underscore"
  });

const metadataSchema = z.record(z.string(), z.unknown());
const tagsSchema = z.array(tagInputSchema).max(50).optional();

export const contentSizeSchema = z
  .string()
  .min(1)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 500 * 1024, {
    message: "CONTENT_LIMIT_EXCEEDED"
  });

export const createEntrySchema = z.object({
  type: writableEntryTypeSchema,
  title: z.string().trim().min(1).max(240),
  body_markdown: contentSizeSchema,
  metadata: metadataSchema.optional(),
  tags: tagsSchema,
  created_by: z.string().trim().min(1).max(120).optional()
}).strict();

export const updateEntrySchema = z.object({
  expected_version: z.number().int().positive(),
  title: z.string().trim().min(1).max(240).optional(),
  body_markdown: contentSizeSchema,
  metadata: metadataSchema.optional(),
  tags: tagsSchema,
  created_by: z.string().trim().min(1).max(120).optional()
}).strict();

export const ownerLoginSchema = z
  .object({
    username: z.string().trim().min(1),
    password: z.string().min(1)
  })
  .strict();

export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    scopes: z.array(apiKeyScopeSchema).min(1)
  })
  .strict();

export const createProposalSchema = z
  .object({
    proposal_markdown: contentSizeSchema,
    rationale: z.string().trim().min(1).max(4000),
    proposer: z.string().trim().min(1).max(120).optional(),
    action_type: z.enum(["improve", "archive"]).optional()
  })
  .strict();

export const reviewProposalSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    decision_notes: z.string().trim().max(4000).optional()
  })
  .strict();

export const proposalListQuerySchema = z
  .object({
    status: z.enum(["pending", "approved", "rejected"]).optional()
  })
  .strict();

export const ownerEntriesQuerySchema = z
  .object({
    q: z.string().optional().default(""),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict();

export const uploadAgentSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    body_markdown: contentSizeSchema,
    metadata: metadataSchema.optional(),
    tags: tagsSchema
  })
  .strict();

export const listPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20)
});

export const relationSchema = z.enum([
  "caused_by",
  "resolved_by",
  "used_skill",
  "composes",
  "related_to"
]);

export const linkEntriesSchema = z
  .object({
    source_entry_id: z.string().trim().min(1),
    target_entry_id: z.string().trim().min(1),
    relation_type: relationSchema,
    created_by: z.string().trim().min(1).max(120).optional()
  })
  .strict();

export const mcpInitializeRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]),
    method: z.literal("initialize"),
    params: z
      .object({
        protocolVersion: z.string().trim().min(1),
        capabilities: z.record(z.string(), z.unknown()),
        clientInfo: z
          .object({
            name: z.string().trim().min(1),
            version: z.string().trim().min(1)
          })
          .passthrough()
      })
      .passthrough()
  })
  .passthrough();

export function parseOrThrow<T>(schema: ZodType<T>, value: unknown, context: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const detail = issue?.message ?? "Invalid request payload";
    throw new DomainError("INVALID_INPUT", `${context}: ${detail}`);
  }

  return parsed.data;
}
