import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automaticDancer, needsDancerConfirmation, isDancerDetection, isDancerTarget } from '../app/lib/dancer-selection.ts';
import { makeCritiqueKey } from '../app/lib/critique-key.ts';
const detection = { status: 'single', confidence: 'high', referenceSeconds: 2, candidates: [{ description: 'Blue shirt, left of frame.' }], explanation: 'One clear dancer.' };
test('a saved choice can be reused or explicitly reopened', () => {
  assert.ok(isDancerDetection({ ...detection, visiblePersonCount: 1 }));
  const savedTarget = { ...detection.candidates[0], referenceSeconds: detection.referenceSeconds };
  assert.equal(needsDancerConfirmation(null, false), true);
  assert.equal(needsDancerConfirmation(savedTarget, false), false);
  assert.equal(needsDancerConfirmation(savedTarget, true), true);
});

test('only a confident, consistent solo result can skip the picker', () => {
  const solo = { ...detection, visiblePersonCount: 1 };
  assert.deepEqual(automaticDancer(solo, false), { ...detection.candidates[0], referenceSeconds: detection.referenceSeconds });
  assert.equal(automaticDancer(solo, true), null);
  assert.equal(automaticDancer(detection, false), null);
  assert.equal(automaticDancer({ ...solo, visiblePersonCount: 2 }, false), null);
  assert.equal(automaticDancer({ ...solo, status: 'multiple' }, false), null);
  assert.equal(automaticDancer({ ...solo, status: 'uncertain' }, false), null);
  assert.equal(automaticDancer({ ...solo, confidence: 'medium' }, false), null);
  assert.equal(automaticDancer({ ...solo, candidates: [...solo.candidates, { description: 'Right dancer' }] }, false), null);
});
test('invalid reference times and descriptions cannot become dancer selections', () => {
  for (const referenceSeconds of [-1, NaN, Infinity, 10801, '2']) assert.equal(isDancerTarget({ description: 'Blue shirt', referenceSeconds }), false);
  for (const description of ['', '  ', 'x'.repeat(801), null]) assert.equal(isDancerTarget({ description, referenceSeconds: 0 }), false);
  assert.equal(isDancerDetection({ ...detection, candidates: [null] }), false);
});
test('critique keys distinguish selected dancers and preserve legacy account isolation', () => {
  const legacy = makeCritiqueKey('a', 'b', 'user');
  const first = makeCritiqueKey('a', 'b', 'user', { earlier: 'one', newer: 'two' });
  assert.notEqual(first, legacy);
  assert.notEqual(first, makeCritiqueKey('a', 'b', 'user', { earlier: 'other', newer: 'two' }));
  assert.notEqual(first, makeCritiqueKey('a', 'b', 'user', { earlier: 'one', newer: 'other' }));
  assert.notEqual(first, makeCritiqueKey('a', 'b', 'other-user', { earlier: 'one', newer: 'two' }));
  assert.equal(legacy, makeCritiqueKey('a', 'b', 'user', { earlier: null, newer: null }));
});
