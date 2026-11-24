import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { getMigrations } from 'better-auth/db/migration';
import { callEmailAuth, isValidEmailAddress } from '../app/lib/email-auth-request.ts';
import { getPasswordRequirements, meetsPasswordPolicy, passwordEntryError, passwordPattern } from '../app/lib/password-policy.ts';
import { checkStagingEmailRequest, stagingAccessError, stagingDatabaseHooks, stagingEmailAllowed, stagingUserAllowed } from '../app/lib/staging-access.ts';

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === './roster-invite-links' && context.parentURL?.endsWith('/auth-email.ts')) {
    return nextResolve(new URL('./roster-invite-links.ts', context.parentURL).href, context);
  }
  return nextResolve(specifier, context);
} });
const { emailVerificationOptions, passwordResetExpiresIn, sendPasswordResetEmail } = await import('../app/lib/auth-email.ts');
hook.deregister();

test('email address validation accepts aliases and rejects malformed addresses', () => {
  assert.ok(isValidEmailAddress('dancer+practice@example.com'));
  for (const email of ['two@@example.com', 'a..b@example.com', 'a@-example.com', 'a@localhost', 'a b@example.com']) {
    assert.equal(isValidEmailAddress(email), false, email);
  }
});

test('signup and reset require strength and matching confirmation', () => {
  const valid = 'DanceSteps1!';
  assert.deepEqual(getPasswordRequirements('').map(({ met }) => met), [false, false, false, false]);
  assert.deepEqual(getPasswordRequirements('DanceSteps1').map(({ met }) => met), [true, true, true, false]);
  assert.ok(getPasswordRequirements(valid).every(({ met }) => met));
  assert.equal(passwordEntryError(valid, valid), null);
  assert.equal(passwordEntryError(valid, 'DanceSteps2!'), 'password-mismatch');
  assert.equal(passwordEntryError(valid, null), 'password-mismatch');
  assert.ok(new RegExp(`^(?:${passwordPattern})$`, 'v').test(valid));
  for (const password of ['dancesteps1!', 'DanceSteps!', 'DanceSteps1', 'DanceSteps1 ', 'Aa1!', valid + '\n', valid.repeat(12)]) {
    assert.equal(meetsPasswordPolicy(password), false, password);
    assert.equal(passwordEntryError(password, password), 'weak-password');
  }
});

test('staging gates signup and sessions using the current list of verified emails', async (t) => {
  const previous = process.env.STAGING_ALLOWED_EMAILS;
  t.after(() => {
    if (previous === undefined) delete process.env.STAGING_ALLOWED_EMAILS;
    else process.env.STAGING_ALLOWED_EMAILS = previous;
  });
  delete process.env.STAGING_ALLOWED_EMAILS;
  assert.equal(stagingUserAllowed({ email: 'outsider@example.test', emailVerified: false }), true);
  process.env.STAGING_ALLOWED_EMAILS = '';
  assert.equal(stagingEmailAllowed('tester@example.test'), false);
  process.env.STAGING_ALLOWED_EMAILS = ' TESTER@example.test, other@example.test ';

  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  const origin = 'http://localhost:3000';
  let verificationLink;
  const config = {
    database,
    baseURL: origin,
    secret: randomBytes(32).toString('base64'),
    databaseHooks: stagingDatabaseHooks,
    emailAndPassword: { enabled: true, requireEmailVerification: true },
    emailVerification: { sendOnSignUp: true, sendVerificationEmail: async ({ url }) => { verificationLink = url; } },
    hooks: { before: createAuthMiddleware(async (ctx) => checkStagingEmailRequest(ctx.path, ctx.body?.email)) },
    rateLimit: { enabled: false },
  };
  await (await getMigrations(config)).runMigrations();
  const auth = betterAuth(config);
  const context = await auth.$context;
  const request = new Request(origin, { headers: { Origin: origin } });
  const credentials = { name: 'Tester', email: 'tester@example.test', password: 'Strong-Dance1!' };
  const rejected = await callEmailAuth(auth.handler, request, '/api/auth/sign-up/email', { ...credentials, email: 'outsider@example.test' });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).code, stagingAccessError);
  assert.equal(await context.internalAdapter.findUserByEmail('outsider@example.test'), null);
  await assert.rejects(context.internalAdapter.createUser({ email: 'outsider@example.test', name: 'Unapproved OAuth user', emailVerified: true }), { status: 'FORBIDDEN' });
  await assert.rejects(context.internalAdapter.createUser({ email: 'other@example.test', name: 'Unverified OAuth user', emailVerified: false }), { status: 'FORBIDDEN' });
  assert.equal((await callEmailAuth(auth.handler, request, '/api/auth/sign-up/email', credentials)).status, 200);
  const signIn = () => callEmailAuth(auth.handler, request, '/api/auth/sign-in/email', credentials);
  assert.equal((await signIn()).status, 403);
  assert.ok(verificationLink);
  await auth.handler(new Request(verificationLink));
  const login = await signIn();
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().find((entry) => entry.includes('session_token')).split(';')[0];
  const getSession = () => auth.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true } });
  assert.equal(stagingUserAllowed((await getSession()).user), true);
  process.env.STAGING_ALLOWED_EMAILS = 'other@example.test';
  assert.equal(stagingUserAllowed((await getSession()).user), false);
  const blocked = await signIn();
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, stagingAccessError);
});

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

test('email signup requires mailbox verification and valid credentials can resend the link', async (t) => {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  const origin = 'https://one-dance-staging.onrender.com';
  const previous = { key: process.env.RESEND_API_KEY, from: process.env.AUTH_EMAIL_FROM };
  process.env.RESEND_API_KEY = 'mock-key';
  process.env.AUTH_EMAIL_FROM = 'One Dance <accounts@example.com>';
  t.after(() => {
    if (previous.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.key;
    if (previous.from === undefined) delete process.env.AUTH_EMAIL_FROM; else process.env.AUTH_EMAIL_FROM = previous.from;
  });
  const deliveries = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(init.headers.Authorization, 'Bearer mock-key');
    deliveries.push(JSON.parse(init.body));
    return Response.json({ id: 'mock-email' });
  });
  const config = {
    database,
    baseURL: origin,
    secret: randomBytes(32).toString('base64'),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: passwordResetExpiresIn,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => sendPasswordResetEmail(user.email, url),
    },
    emailVerification: emailVerificationOptions,
    rateLimit: { enabled: false },
  };
  await (await getMigrations(config)).runMigrations();
  const auth = betterAuth(config);
  const request = new Request(origin, { headers: { Origin: origin } });
  const credentials = { email: 'practice@example.com', password: 'test-only-password' };
  const signUp = () => callEmailAuth(auth.handler, request, '/api/auth/sign-up/email', { name: 'Practice', ...credentials });
  const signIn = (body = credentials) => callEmailAuth(auth.handler, request, '/api/auth/sign-in/email', body);

  const signup = await signUp();
  assert.equal(signup.status, 200);
  assert.equal((await signup.json()).token, null);
  assert.equal(signup.headers.getSetCookie().length, 0);
  assert.equal((await signUp()).status, 200);
  assert.equal((await signIn({ ...credentials, password: 'wrong-password' })).status, 401);
  assert.equal(deliveries.length, 1);
  assert.equal((await (await signIn()).json()).code, 'EMAIL_NOT_VERIFIED');
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries[1].to, [credentials.email]);
  const link = new URL(deliveries[1].text.split('\n\n')[1]);
  assert.equal(link.origin, origin);
  assert.equal(link.searchParams.get('callbackURL'), '/sign-in?verification=confirmed');
  const verified = await auth.handler(new Request(link));
  assert.equal(verified.status, 302);
  assert.equal(verified.headers.get('location'), '/sign-in?verification=confirmed');
  const login = await signIn();
  assert.equal(login.status, 200);
  const sessionCookie = login.headers.getSetCookie().find((cookie) => cookie.includes('session_token')).split(';')[0];
  assert.ok(await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) }));

  const requestReset = (email) => callEmailAuth(auth.handler, request, '/api/auth/request-password-reset', { email, redirectTo: '/reset-password' });
  const missing = await requestReset('unknown@example.com');
  assert.equal(missing.status, 200);
  assert.equal(deliveries.length, 2);
  const requested = await requestReset(credentials.email);
  assert.equal(requested.status, 200);
  assert.deepEqual(await requested.json(), await missing.json());
  assert.equal(deliveries.length, 3);
  const resetLink = new URL(deliveries[2].text.split('\n\n')[1]);
  assert.equal(resetLink.origin, origin);
  const callback = await auth.handler(new Request(resetLink));
  assert.equal(callback.status, 302);
  const resetFormUrl = new URL(callback.headers.get('location'), origin);
  assert.equal(resetFormUrl.pathname, '/reset-password');
  const token = resetFormUrl.searchParams.get('token');
  assert.ok(token);
  const newPassword = 'New-Dance-Pass1!';
  const reset = () => callEmailAuth(auth.handler, request, '/api/auth/reset-password', { token, newPassword });
  assert.equal((await reset()).status, 200);
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) }), null);
  assert.equal((await reset()).status, 400);
  assert.equal((await signIn()).status, 401);
  assert.equal((await signIn({ ...credentials, password: newPassword })).status, 200);

  const invitePath = `/roster-invites/${randomBytes(32).toString('base64url')}`;
  const callbackURL = `/sign-in?${new URLSearchParams({ next: invitePath })}`;
  const invited = { name: 'Invited Student', email: 'invited@example.com', password: newPassword, callbackURL };
  assert.equal((await callEmailAuth(auth.handler, request, '/api/auth/sign-up/email', invited)).status, 200);
  const inviteVerification = new URL(deliveries.at(-1).text.split('\n\n')[1]);
  const verificationResponse = await auth.handler(new Request(inviteVerification));
  const inviteReturn = new URL(verificationResponse.headers.get('location'), origin);
  assert.equal(inviteReturn.pathname, '/sign-in');
  assert.equal(inviteReturn.searchParams.get('next'), invitePath);
  assert.equal((await signIn(invited)).status, 200);
});
