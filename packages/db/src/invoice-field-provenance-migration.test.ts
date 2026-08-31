import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const migrationTag = '20260831054304_invoice_review_signals';

test('invoice field provenance migration contains the runtime provenance shape', async () => {
  const migration = await readFile(join(__dirname, 'migrations', `${migrationTag}.sql`), 'utf8');

  assert.match(migration, /"superseded_at" timestamp with time zone/);
  assert.match(migration, /field_path.*~ '\^lines\\\.[^']+\\\./s);
  assert.match(migration, /invoice_field_provenance_invoice_org_fk/);
  assert.match(migration, /invoice_field_provenance_actor_org_fk/);
  assert.match(migration, /invoice_field_provenance_invoice_current_idx/);
  assert.match(migration, /invoice_field_provenance_source_type_check/);
  assert.match(migration, /invoice_field_provenance_field_path_check/);
  assert.match(migration, /invoice_field_provenance_confidence_check/);
});
