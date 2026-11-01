import { z } from 'zod';

/**
 * Nest-side tracking status for an AI invocation (source of truth for FE/jobs).
 * PENDING / RUNNING never appear on AiExecutionResult.
 */
export const aiExecutionTrackingStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export type AiExecutionTrackingStatus = z.infer<
  typeof aiExecutionTrackingStatusSchema
>;

/** Alias documented as AiExecutionStatus in AI-002 tracking section. */
export const aiExecutionStatusSchema = aiExecutionTrackingStatusSchema;
export type AiExecutionStatus = AiExecutionTrackingStatus;

/** Terminal statuses allowed on AiExecutionResult.status */
export const aiExecutionResultStatusSchema = z.enum([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export type AiExecutionResultStatus = z.infer<
  typeof aiExecutionResultStatusSchema
>;
