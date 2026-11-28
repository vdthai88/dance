import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as scoring from '../app/lib/gemini-critique.ts';

// Render the real components without a browser or a live AI request.
function loadComponent(relativePath, dependencies = {}, suffix = '') {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = readFileSync(path, 'utf8') + suffix;
  const { outputText } = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const localRequire = createRequire(path);
  const compiledModule = { exports: {} };
  new Function('require', 'module', 'exports', outputText)((name) => dependencies[name] ?? localRequire(name), compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const card = loadComponent('../app/components/critique-card.tsx', { '../lib/gemini-critique': scoring });
const { ReviewPlayer, SavedVideoReview } = loadComponent('../app/components/saved-video-review.tsx', {
  './critique-card': card,
  '../lib/api-response': { readApiJson() { throw new Error('No API call is expected during server rendering'); } },
}, '\nexport { ReviewPlayer };');
const { DancerSelectionPanel } = loadComponent('../app/components/dancer-selection-panel.tsx', {
  '../lib/api-response': { readApiJson() { throw new Error('No API call is expected during server rendering'); } },
});
const video = { id: 'saved-video', filename: 'practice.mp4', available: true };
const review = { comparison: false, critique: { summary: 'Finished feedback in the saved review.', observations: [], limitations: [] } };
const pendingContent = React.createElement('aside', { role: 'status' }, 'AI is reviewing your video');

test('processing is shown beside one saved player instead of displaying a second preview', () => {
  const html = renderToStaticMarkup(React.createElement(ReviewPlayer, { video, review, pendingContent }));
  assert.equal((html.match(/<video\b/g) ?? []).length, 1);
  assert.match(html, /AI is reviewing your video/);
  assert.doesNotMatch(html, /Finished feedback in the saved review/);
  assert.match(html, /\/api\/replai-videos\/saved-video\/content/);
});

test('the finished critique occupies the same saved review with just one player', () => {
  const html = renderToStaticMarkup(React.createElement(ReviewPlayer, { video, review }));
  assert.equal((html.match(/<video\b/g) ?? []).length, 1);
  assert.match(html, /Finished feedback in the saved review/);
  assert.doesNotMatch(html, /AI is reviewing your video/);
});

test('scored feedback shows the total and three categories before the notes', () => {
  const scoredReview = { ...review, scoreRanking: { place: 12, totalScores: 84 }, critique: { ...review.critique, scores: { technicalAbility: 38, difficulty: 20, performance: 27 } } };
  const html = renderToStaticMarkup(React.createElement(ReviewPlayer, { video, review: scoredReview }));
  assert.match(html, /Total score.*85 \/ 100.*Technical ability.*38 \/ 45.*Difficulty.*20 \/ 25.*Performance.*27 \/ 30.*Finished feedback/);
  assert.match(html, /Total score.*85 \/ 100.*critique-score-ranking.*<svg.*<dt>Ranked<\/dt><dd>#12<\/dd>.*Technical ability/);
  assert.doesNotMatch(html, /of 84 scores/);
});

test('a newly saved upload can display its player and processing status before feedback loads', () => {
  const html = renderToStaticMarkup(React.createElement(SavedVideoReview, { videoId: video.id, video, revision: 'new', pendingContent }));
  assert.equal((html.match(/<video\b/g) ?? []).length, 1);
  assert.match(html, /AI is reviewing your video/);
  assert.doesNotMatch(html, /No AI critique is saved/);
});

test('dancer confirmation uses a reference frame without adding a second visible player', () => {
  const selection = React.createElement(DancerSelectionPanel, { videoId: video.id, title: video.filename,
    detection: { status: 'multiple', confidence: 'high', referenceSeconds: 2, candidates: [{ description: 'Left dancer' }, { description: 'Right dancer' }], explanation: 'Two dancers excluding reflections.' }, onChosen() {} });
  const html = renderToStaticMarkup(React.createElement(ReviewPlayer, { video, review: null, pendingContent: selection }));
  assert.equal((html.match(/<video\b/g) ?? []).length, 1);
  assert.match(html, /<canvas/);
  assert.match(html, /Who should AI focus on/);
  assert.match(html, /Left dancer/);
  assert.match(html, /Right dancer/);
  assert.match(html, /disabled="">Use this dancer/);
});
