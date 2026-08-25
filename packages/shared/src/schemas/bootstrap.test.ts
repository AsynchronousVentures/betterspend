import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bootstrapInstanceSchema } from './bootstrap';

describe('bootstrapInstanceSchema', () => {
  it('normalizes bootstrap identity fields', () => {
    const parsed = bootstrapInstanceSchema.parse({
      organizationName: '  Acme Corp  ',
      name: '  First Admin  ',
      email: '  ADMIN@EXAMPLE.TEST  ',
      password: 'a secure password',
    });
    assert.equal(parsed.organizationName, 'Acme Corp');
    assert.equal(parsed.name, 'First Admin');
    assert.equal(parsed.email, 'admin@example.test');
  });

  it('rejects passwords outside Better Auth limits', () => {
    const input = {
      organizationName: 'Acme Corp',
      name: 'First Admin',
      email: 'admin@example.test',
    };
    assert.equal(bootstrapInstanceSchema.safeParse({ ...input, password: 'short' }).success, false);
    assert.equal(
      bootstrapInstanceSchema.safeParse({ ...input, password: 'x'.repeat(129) }).success,
      false,
    );
  });
});
