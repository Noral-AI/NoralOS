import { z } from "zod";
import {
  COMPANY_STATUSES,
  MAX_COMPANY_ATTACHMENT_MAX_BYTES,
} from "../constants.js";

const logoAssetIdSchema = z.string().uuid().nullable().optional();
const brandColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional();
const feedbackDataSharingTermsVersionSchema = z.string().min(1).nullable().optional();
const attachmentMaxBytesSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_COMPANY_ATTACHMENT_MAX_BYTES);

export const createCompanySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  budgetMonthlyCents: z.number().int().nonnegative().optional().default(0),
  attachmentMaxBytes: attachmentMaxBytesSchema.optional(),
});

export type CreateCompany = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = createCompanySchema
  .partial()
  .extend({
    status: z.enum(COMPANY_STATUSES).optional(),
    spentMonthlyCents: z.number().int().nonnegative().optional(),
    requireBoardApprovalForNewAgents: z.boolean().optional(),
    feedbackDataSharingEnabled: z.boolean().optional(),
    feedbackDataSharingConsentAt: z.coerce.date().nullable().optional(),
    feedbackDataSharingConsentByUserId: z.string().min(1).nullable().optional(),
    feedbackDataSharingTermsVersion: feedbackDataSharingTermsVersionSchema,
    brandColor: brandColorSchema,
    logoAssetId: logoAssetIdSchema,
    attachmentMaxBytes: attachmentMaxBytesSchema.optional(),
  });

export type UpdateCompany = z.infer<typeof updateCompanySchema>;

export const updateCompanyBrandingSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    brandColor: brandColorSchema,
    logoAssetId: logoAssetIdSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined
      || value.description !== undefined
      || value.brandColor !== undefined
      || value.logoAssetId !== undefined,
    "At least one branding field must be provided",
  );

export type UpdateCompanyBranding = z.infer<typeof updateCompanyBrandingSchema>;

/**
 * Company-wide "LLM backend" switch.
 *
 *   - `native`      → each agent runs on its own stored adapter (e.g. claude_local).
 *   - `deepseek_v4` → every agent is forced onto `opencode_local` + DeepSeek V4
 *                     at EXECUTION time (heartbeat override). The agent rows are
 *                     never mutated, so flipping back to `native` is lossless.
 *
 * `model` is the OpenCode model id (provider/model form) used when running on
 * DeepSeek; `credentialId` references the company's `noralai_brooklyn`
 * integration credential that holds the DeepSeek API key. The key is resolved
 * to plaintext just-in-time per run and injected as `DEEPSEEK_API_KEY`.
 */
export const COMPANY_LLM_BACKEND_MODES = ["native", "deepseek_v4"] as const;

/** Provider key for the OpenCode provider config that resolves DeepSeek models. */
export const DEEPSEEK_OPENCODE_PROVIDER = "deepseek";

/** Default OpenCode model id when a company switches to the DeepSeek backend. */
export const DEFAULT_DEEPSEEK_OPENCODE_MODEL = "deepseek/deepseek-v4-pro";

/** Operator-selectable DeepSeek models (OpenCode `provider/model` ids). */
export const DEEPSEEK_OPENCODE_MODELS = [
  { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash (cheaper)" },
] as const;

const deepseekOpenCodeModelSchema = z
  .string()
  .trim()
  .min(1)
  .regex(
    /^deepseek\/[\w.-]+$/i,
    "Model must be an OpenCode DeepSeek model id, e.g. deepseek/deepseek-v4-pro",
  );

export const updateCompanyLlmBackendSchema = z
  .object({
    mode: z.enum(COMPANY_LLM_BACKEND_MODES),
    model: deepseekOpenCodeModelSchema.optional(),
    credentialId: z.string().uuid().optional(),
  })
  .strict()
  .refine((value) => value.mode !== "deepseek_v4" || Boolean(value.credentialId), {
    message: "credentialId is required when mode is deepseek_v4",
    path: ["credentialId"],
  });

export type UpdateCompanyLlmBackend = z.infer<typeof updateCompanyLlmBackendSchema>;
