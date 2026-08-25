import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicPath } from './middleware';

test('keeps runtime release metadata public', () => {
  assert.equal(isPublicPath('/runtime-version'), true);
  assert.equal(isPublicPath('/runtime-version/details'), false);
  assert.equal(isPublicPath('/workspace-settings'), false);
});
