import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readApiJson } from '../app/lib/api-response.ts';

test('accepts JSON success including an empty saved-critique lookup', async () => {
  assert.equal(await readApiJson(new Response('null'), 'Lookup'), null);
  assert.deepEqual(await readApiJson(Response.json({ summary: 'Good' }), 'Critique'), { summary: 'Good' });
});

test('preserves API error details', async () => {
  await assert.rejects(readApiJson(Response.json({ error: 'Gemini reached a usage limit.' }, { status: 429 }), 'Critique'), /Gemini reached a usage limit/);
});

test('explains an empty gateway response with its HTTP status', async () => {
  await assert.rejects(readApiJson(new Response(null, { status: 502 }), 'Critique'), /empty response \(HTTP 502\).*Render Logs/);
});

test('does not expose a proxy HTML response', async () => {
  await assert.rejects(readApiJson(new Response('<html>PRIVATE UPSTREAM DETAIL</html>', { status: 413 }), 'Critique'), (error) => {
    assert.match(error.message, /HTTP 413.*too large/);
    assert.doesNotMatch(error.message, /PRIVATE UPSTREAM DETAIL/);
    return true;
  });
});

test('rejects malformed JSON even with a successful HTTP status', async () => {
  await assert.rejects(readApiJson(new Response('{'), 'Critique'), /non-JSON response \(HTTP 200\)/);
});

test('profile and company requests report their own operation when a response has no data', async () => {
  await assert.rejects(readApiJson(new Response(null, { status: 502 }), 'Create company', 'Could not confirm company creation.'), {
    message: 'Could not confirm company creation. (HTTP 502)',
  });
  await assert.rejects(readApiJson(Response.json(null), 'Profile', 'Could not load your profile.'), /Could not load your profile/);
});
