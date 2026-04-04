import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    LIBRAXIS_DB_PATH: z.string().min(1).default("./data/libraxis.db"),
    LIBRAXIS_ADMIN_USERNAME: z.string().min(1).default("admin"),
    LIBRAXIS_ADMIN_PASSWORD: z.string().min(1).default("change-me"),
    LIBRAXIS_SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
    LIBRAXIS_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
    LIBRAXIS_MCP_API_KEY: z.string().default("")
  })
  .superRefine((value, ctx) => {
    const hasDefaultCredentials =
      value.LIBRAXIS_ADMIN_USERNAME === "admin" && value.LIBRAXIS_ADMIN_PASSWORD === "change-me";

    if (value.NODE_ENV === "production" && hasDefaultCredentials) {
      ctx.addIssue({
        code: "custom",
        message:
          "Production requires non-default owner credentials. Set LIBRAXIS_ADMIN_USERNAME and LIBRAXIS_ADMIN_PASSWORD."
      });
    }
  });

const envSchema = rawEnvSchema.transform((value) => ({
  ...value,
  LIBRAXIS_COOKIE_SECURE:
    value.LIBRAXIS_COOKIE_SECURE !== undefined
      ? value.LIBRAXIS_COOKIE_SECURE === "true"
      : value.NODE_ENV === "production"
}));

export function parseEnv(input: NodeJS.ProcessEnv) {
  return envSchema.parse(input);
}

export const env = parseEnv(process.env);