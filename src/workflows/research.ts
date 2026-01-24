import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

export type ResearchWorkflowPayload = {
  userId: string;
  query: string;
  taskId: string;
};

export class ResearchWorkflow extends WorkflowEntrypoint<ResearchWorkflowPayload> {
  async run(
    event: Readonly<WorkflowEvent<ResearchWorkflowPayload>>,
    step: WorkflowStep
  ): Promise<{ ok: true }> {
    const { userId, query, taskId } = event.payload;

    void userId;
    void query;
    void taskId;

    return { ok: true };
  }
}
