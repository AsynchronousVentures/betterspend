import { randomBytes } from 'node:crypto';
import type { webhookEndpoints } from './schema';

type WebhookEndpointInsert = typeof webhookEndpoints.$inferInsert;
type WebhookEndpointSeedRow = Omit<WebhookEndpointInsert, 'secret'>;

/** Materialize secrets only at the persistence boundary, never in the pure graph. */
export function materializeWebhookSecrets(
  rows: readonly WebhookEndpointSeedRow[],
  createSecret: () => string = () => randomBytes(32).toString('hex'),
): WebhookEndpointInsert[] {
  return rows.map((row) => ({ ...row, secret: createSecret() }));
}
