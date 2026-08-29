export interface WorkflowRequestIdentity {
  definitionId: string;
  requestId: number;
}

export function isCurrentWorkflowRequest(
  activeDefinitionId: string | null,
  latestRequestId: number,
  request: WorkflowRequestIdentity,
): boolean {
  return activeDefinitionId === request.definitionId && latestRequestId === request.requestId;
}
