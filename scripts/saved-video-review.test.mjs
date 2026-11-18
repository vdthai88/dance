import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

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
const card = loadComponent('../app/components/critique-card.tsx');
const { ReviewPlayer, SavedVideoReview } = loadComponent('../app/components/saved-video-review.tsx', {
  './critique-card': card,
  '../lib/api-response': { readApiJson() { throw new Error('No API call is expected during server rendering'); } },
}, '\nexport { ReviewPlayer };');
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

test('a newly saved upload can display its player and processing status before feedback loads', () => {
  const html = renderToStaticMarkup(React.createElement(SavedVideoReview, { videoId: video.id, video, revision: 'new', pendingContent }));
  assert.equal((html.match(/<video\b/g) ?? []).length, 1);
  assert.match(html, /AI is reviewing your video/);
  assert.doesNotMatch(html, /No AI critique is saved/);
});
