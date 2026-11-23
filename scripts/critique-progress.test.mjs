import { test } from 'node:test';
import assert from 'node:assert/strict';
import { danceComparisonSchema, danceCritiqueSchema, hasComparisonProgress, isDanceCritique, totalDanceScore } from '../app/lib/gemini-critique.ts';

const observation = {
  timestampSeconds: 37, area: 'Balance', observation: 'The landing is steadier.',
  suggestedAdjustment: 'Continue practising a controlled landing.', exercise: 'Hold the landing.', confidence: 'medium', video: 'new',
};
function comparison() {
  return {
    summary: 'Practice feedback.', comparison: 'Visible changes and fresh observations.', limitations: [],
    observations: ['improved', 'keep_practising', 'unassessable', 'new', 'new'].map((progressStatus, index) => ({
      ...observation, progressStatus, progressReason: 'Evidence and a constructive explanation.',
      baselineObservationIndex: index < 3 ? index + 1 : null,
    })),
  };
}

test('newer-video timestamps are independent of whether a coaching note is new', () => {
  const result = comparison();
  assert.equal(hasComparisonProgress(result, 3), true);
  assert.equal(result.observations[0].video, 'new');
  assert.equal(result.observations[0].progressStatus, 'improved');
  assert.equal(result.observations[1].progressStatus, 'keep_practising');
  assert.equal(result.observations[3].baselineObservationIndex, null);
  const required = danceComparisonSchema.properties.observations.items.required;
  for (const property of ['progressStatus', 'progressReason', 'baselineObservationIndex']) assert.ok(required.includes(property));
});

test('legacy feedback stays readable but is not reused as a classified comparison', () => {
  const legacy = { summary: 'Original critique.', observations: [observation], limitations: [] };
  assert.equal(isDanceCritique(legacy), true);
  assert.equal(hasComparisonProgress(legacy), false);
  const oldComparison = { ...legacy, comparison: 'Old comparison.', observations: Array.from({ length: 5 }, () => ({ ...observation })) };
  assert.equal(isDanceCritique(oldComparison), true);
  assert.equal(hasComparisonProgress(oldComparison), false);
});

test('dance scores use bounded whole points and require all three categories for a total', () => {
  const scores = { technicalAbility: 38, difficulty: 20, performance: 27 };
  assert.equal(isDanceCritique({ ...comparison(), scores }), true);
  assert.equal(totalDanceScore(scores), 85);
  assert.equal(totalDanceScore({ technicalAbility: 45, difficulty: 25, performance: 30 }), 100);
  for (const value of [-1, 26, 10.5, '20', undefined]) {
    assert.equal(isDanceCritique({ ...comparison(), scores: { ...scores, difficulty: value } }), false);
  }
  const partial = { ...scores, difficulty: null };
  assert.equal(isDanceCritique({ ...comparison(), scores: partial }), true);
  assert.equal(totalDanceScore(partial), null);
  assert.ok(danceCritiqueSchema.required.includes('scores'));
  assert.ok(danceComparisonSchema.required.includes('scores'));
});

test('progress requires valid categories, evidence and baseline references', () => {
  const check = (changes, valid = false) => {
    const result = comparison();
    Object.assign(result.observations[0], changes);
    assert.equal(hasComparisonProgress(result, 3), valid);
  };
  check({ progressStatus: 'worse' });
  check({ progressStatus: undefined });
  check({ progressReason: '' });
  check({ progressReason: '   ' });
  check({ baselineObservationIndex: 0 });
  check({ baselineObservationIndex: 1.5 });
  check({ baselineObservationIndex: 4 });
  check({ baselineObservationIndex: undefined });
  check({ progressStatus: 'new', baselineObservationIndex: 1 });
  check({ progressStatus: 'new', baselineObservationIndex: null }, true);
  const withoutBaseline = comparison();
  withoutBaseline.observations.forEach((note) => { note.baselineObservationIndex = null; });
  assert.equal(hasComparisonProgress(withoutBaseline, 0), true);
  assert.equal(hasComparisonProgress(JSON.parse(JSON.stringify(comparison())), 3), true);
});
