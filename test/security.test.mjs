import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';
import { newCsrfToken, csrfValid, hostAllowed, originAllowed, readCookie, cookie } from '../src/security.mjs';

test('CSRF tokens validate only on exact constant-time match', () => {
  const t = newCsrfToken();
  assert.equal(t.length, 64);
  assert.equal(csrfValid(t, t), true);
  assert.equal(csrfValid(t, t.slice(0, -1) + '0'), false);
  assert.equal(csrfValid(t, ''), false);
  assert.equal(csrfValid('', ''), false);
  assert.equal(csrfValid(t, undefined), false);
  assert.equal(csrfValid(undefined, t), false);
  assert.equal(csrfValid(t, t + 'extra'), false);
});

test('host allow-list accepts loopback and canonical host, rejects others', () => {
  const dev = loadConfig({});
  assert.equal(hostAllowed('127.0.0.1:41', dev, 41), true);
  assert.equal(hostAllowed('localhost:41', dev, 41), true);
  assert.equal(hostAllowed('evil.example', dev, 41), false);
  assert.equal(hostAllowed(undefined, dev, 41), false);
  const prod = loadConfig({ AIVORA_ENV: 'production', AIVORA_CANONICAL_ORIGIN: 'https://store.terminow.online', AIVORA_TRUST_PROXY: '1' });
  assert.equal(hostAllowed('store.terminow.online', prod, 41), true);
  assert.equal(hostAllowed('127.0.0.1:41', prod, 41), true);
  assert.equal(hostAllowed('attacker.terminow.online', prod, 41), false);
});

test('origin check ignores absent Origin but enforces the allow-list when present', () => {
  const prod = loadConfig({ AIVORA_ENV: 'production', AIVORA_CANONICAL_ORIGIN: 'https://store.terminow.online', AIVORA_TRUST_PROXY: '1' });
  assert.equal(originAllowed(undefined, prod, 41), true);
  assert.equal(originAllowed('https://store.terminow.online', prod, 41), true);
  assert.equal(originAllowed('https://other.example', prod, 41), false);
  assert.equal(originAllowed('http://store.terminow.online', prod, 41), false); // scheme must match
});

test('cookie builder sets SameSite/HttpOnly/Secure per flags', () => {
  assert.match(cookie('session', 'x', { httpOnly: true, secure: true }), /^session=x; SameSite=Strict; Path=\/; Max-Age=86400; HttpOnly; Secure$/);
  assert.match(cookie('csrf', 'y', { httpOnly: false, secure: false }), /^csrf=y; SameSite=Strict; Path=\/; Max-Age=86400$/);
  assert.doesNotMatch(cookie('csrf', 'y', { httpOnly: false }), /HttpOnly/);
  assert.match(cookie('session', '', { maxAge: 0 }), /Max-Age=0/);
});

test('readCookie extracts a named cookie value', () => {
  assert.equal(readCookie('csrf=abc; session=def', 'session'), 'def');
  assert.equal(readCookie('csrf=abc; session=def', 'csrf'), 'abc');
  assert.equal(readCookie('', 'session'), undefined);
  assert.equal(readCookie(undefined, 'session'), undefined);
});
