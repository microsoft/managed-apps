import { githubClient } from '../../../connectors/github';
import { graphQlErrorMessage, graphQlPayload } from '../../graphQlEnvelope';
import type { CommentKind } from './commentEditor';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/** Delete only the addressed comment, never its review or the other replies. */
export async function deleteGithubComment(kind: CommentKind, nodeId: string): Promise<void> {
  const mutation = kind === 'review' ? 'deletePullRequestReviewComment' : 'deleteIssueComment';
  const id = JSON.stringify(nodeId);
  // Both mutations echo clientMutationId; issue-comment deletion has no other payload.
  const query = `mutation { ${mutation}(input: { id: ${id}, clientMutationId: ${id} }) { clientMutationId } }`;
  const result = await githubClient.graphql(query);
  const failure = 'Could not delete this comment';
  if (!result?.success) {
    const detail = result?.error instanceof Error ? result.error.message : undefined;
    throw new Error(detail ? `${failure}: ${detail}` : `${failure}.`);
  }

  const envelope: unknown = result.data;
  const message = graphQlErrorMessage(envelope);
  if (message) throw new Error(`${failure}: ${message}`);
  const payload = asRecord(graphQlPayload(envelope));
  if (asRecord(payload?.[mutation])?.clientMutationId !== nodeId) {
    throw new Error(`${failure}: GitHub did not confirm the deletion.`);
  }
}
