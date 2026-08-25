import { randomBytes } from 'node:crypto';
import type { emailIntakeAddresses, webhookEndpoints } from './schema';

type WebhookEndpointInsert = typeof webhookEndpoints.$inferInsert;
type WebhookEndpointSeedRow = Omit<WebhookEndpointInsert, 'secret'>;
type EmailIntakeAddressInsert = typeof emailIntakeAddresses.$inferInsert;
type EmailIntakeAddressSeedRow = Omit<EmailIntakeAddressInsert, 'token'>;

/** Materialize secrets only at the persistence boundary, never in the pure graph. */
export function materializeWebhookSecrets(
  rows: readonly WebhookEndpointSeedRow[],
  createSecret: () => string = () => randomBytes(32).toString('hex'),
): WebhookEndpointInsert[] {
  return rows.map((row) => ({ ...row, secret: createSecret() }));
}

/** Materialize the inbound address token only at persistence time. */
export function materializeEmailIntakeTokens(
  rows: readonly EmailIntakeAddressSeedRow[],
  createToken: () => string = () => randomBytes(20).toString('hex'),
): EmailIntakeAddressInsert[] {
  return rows.map((row) => ({ ...row, token: createToken() }));
}
