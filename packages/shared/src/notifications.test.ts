import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_TYPE_DEFINITIONS,
  notificationTypeLabel,
} from './notifications';

test('defines the notification defaults and labels in one shared catalog', () => {
  assert.deepEqual(
    DEFAULT_NOTIFICATION_PREFERENCES.enabledTypes,
    NOTIFICATION_TYPE_DEFINITIONS.map(({ value }) => value),
  );
  assert.equal(notificationTypeLabel('approval_request'), 'Approval requests');
  assert.equal(notificationTypeLabel('new_event'), 'new event');
});
