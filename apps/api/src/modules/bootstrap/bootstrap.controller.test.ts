import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { parseBootstrapInput } from './bootstrap.controller';

describe('parseBootstrapInput', () => {
  it('maps invalid public input to an HTTP 400 error', () => {
    assert.throws(
      () =>
        parseBootstrapInput({
          organizationName: 'Acme',
          name: 'Admin',
          email: 'not-an-email',
          password: 'short',
        }),
      BadRequestException,
    );
  });
});
