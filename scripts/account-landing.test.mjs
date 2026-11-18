import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountEntryRedirect, accountLanding, hasSavedProfileNames } from '../app/lib/account-landing.ts';

const saved = { firstName: 'Van', lastName: 'Thai' };
test('first sign-in with missing saved names requires profile setup regardless of role', () => {
  for (const profile of [{}, { firstName: 'Van' }, { lastName: 'Thai' }, { firstName: ' ', lastName: 'Thai' }, { firstName: 'Van', lastName: '' }]) {
    assert.equal(hasSavedProfileNames(profile), false);
    assert.equal(accountLanding(profile, ['student']), '/?page=profile&required=1');
    assert.equal(accountLanding(profile, ['teacher']), '/?page=profile&required=1');
  }
  assert.equal(accountLanding({ name: 'Google display name', firstName: '', lastName: '' }, ['student']), '/?page=profile&required=1');
});
test('returning users with saved names land on their role page without saving again', () => {
  assert.equal(accountLanding(saved, ['student']), '/?page=replai');
  assert.equal(accountLanding(saved, ['teacher']), '/?page=coaching');
  assert.equal(accountLanding(saved, ['student', 'teacher']), '/?page=coaching');
  assert.equal(accountLanding(saved, ['admin']), '/?page=coaching');
  assert.equal(accountLanding({ firstName: ' Van ', lastName: ' Thai ' }, ['student']), '/?page=replai');
});
test('refresh preserves an explicitly chosen page for completed profiles', () => {
  for (const page of ['coaching', 'replai', 'profile']) {
    assert.equal(accountEntryRedirect(saved, ['teacher'], new URLSearchParams({ page })), null);
    assert.equal(accountEntryRedirect(saved, ['student'], new URLSearchParams({ page })), null);
  }
  assert.equal(accountEntryRedirect(saved, ['teacher'], new URLSearchParams()), '/?page=coaching');
  assert.equal(accountEntryRedirect(saved, ['student'], new URLSearchParams()), '/?page=replai');
});
test('stale onboarding flags cannot lock a completed profile', () => {
  assert.equal(accountEntryRedirect(saved, ['student'], new URLSearchParams('page=profile&required=1')), '/?page=replai');
  assert.equal(accountEntryRedirect(saved, ['teacher'], new URLSearchParams('page=profile&required=1')), '/?page=coaching');
  assert.equal(accountEntryRedirect(saved, ['teacher'], new URLSearchParams('page=coaching&required=1')), '/?page=coaching');
});
test('incomplete profiles stay gated without redirect loops', () => {
  assert.equal(accountEntryRedirect({}, ['student'], new URLSearchParams('page=replai')), '/?page=profile&required=1');
  assert.equal(accountEntryRedirect({}, ['teacher'], new URLSearchParams('page=profile')), '/?page=profile&required=1');
  assert.equal(accountEntryRedirect({}, ['student'], new URLSearchParams('page=profile&required=1')), null);
});
