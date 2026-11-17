import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { callEmailAuth } from '../app/lib/email-auth-request.ts';

test('email signup and login work behind a public HTTPS proxy without self-fetching', async () => {
  const database = new DatabaseSync(':memory:');
  const previousUrl = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = 'https://one-dance-staging.onrender.com';
  const config = {
    database,
    secret: randomBytes(32).toString('base64'),
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: ['http://192.168.86.162:3000'],
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
  };
  try {
    await (await getMigrations(config)).runMigrations();
    const auth = betterAuth(config);
    // Render can expose an HTTPS request URL even though its listener is HTTP.
    // No server exists at this port: self-fetching it would fail.
    const request = new Request('https://0.0.0.0:1/api/local-auth/sign-up', {
      method: 'POST', headers: { Origin: process.env.BETTER_AUTH_URL },
    });
    const credentials = { email: 'signup-test@example.test', password: randomBytes(20).toString('hex') };
    const response = await callEmailAuth(auth.handler, request, '/api/auth/sign-up/email', { ...credentials, name: 'Test' });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).user.id);
    assert.ok(response.headers.getSetCookie().some((cookie) => cookie.includes('session_token')));
    const login = await callEmailAuth(auth.handler, request, '/api/auth/sign-in/email', { ...credentials, rememberMe: true });
    assert.equal(login.status, 200);
    assert.ok(login.headers.getSetCookie().some((cookie) => cookie.includes('session_token')));
    const invalidLogin = await callEmailAuth(auth.handler, request, '/api/auth/sign-in/email', { ...credentials, password: 'wrong-password' });
    assert.equal(invalidLogin.status, 401);
    const untrusted = new Request(request.url, { method: 'POST', headers: { Origin: 'https://untrusted.example.test' } });
    const denied = await callEmailAuth(auth.handler, untrusted, '/api/auth/sign-in/email', credentials);
    assert.equal(denied.status, 403);
    // Local Wi-Fi origins are still checked against Better Auth's trusted list.
    const lan = new Request('http://0.0.0.0:3000/api/local-auth/sign-in', { method: 'POST', headers: { Origin: 'http://192.168.86.162:3000' } });
    assert.equal((await callEmailAuth(auth.handler, lan, '/api/auth/sign-in/email', credentials)).status, 200);
  } finally {
    if (previousUrl === undefined) delete process.env.BETTER_AUTH_URL; else process.env.BETTER_AUTH_URL = previousUrl;
    database.close();
  }
});
