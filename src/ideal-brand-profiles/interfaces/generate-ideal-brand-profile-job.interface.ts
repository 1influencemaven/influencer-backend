export interface GenerateIdealBrandProfileJobData {
  influencerId: string;
  /** Snapshot of editable instructions at enqueue time */
  promptInstructions: string;
  /** Optional actor for AiExecutionRequest.context.userId */
  requestedByUserId?: string;
}
