import { z } from 'zod';

export const AnthropicCostResultSchema = z.object({
  amount: z.string(),
  currency: z.string(),
  description: z.string().nullable(),
  model: z.string().nullable(),
  cost_type: z.string().nullable(),
  token_type: z.string().nullable(),
  service_tier: z.string().nullable(),
  context_window: z.string().nullable(),
  inference_geo: z.string().nullable(),
  workspace_id: z.string().nullable(),
});

export const AnthropicCostBucketSchema = z.object({
  starting_at: z.string(),
  ending_at: z.string(),
  results: z.array(AnthropicCostResultSchema),
});

export const AnthropicCostReportResponseSchema = z.object({
  data: z.array(AnthropicCostBucketSchema),
  has_more: z.boolean(),
  next_page: z.string().nullable().optional(),
});

export type AnthropicCostResult = z.infer<typeof AnthropicCostResultSchema>;
export type AnthropicCostBucket = z.infer<typeof AnthropicCostBucketSchema>;
export type AnthropicCostReportResponse = z.infer<typeof AnthropicCostReportResponseSchema>;
