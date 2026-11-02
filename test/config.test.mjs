import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';

test('development defaults are permissive and insecure-cookie for localhost', () => {
  const c = loadConfig({});
  assert.equal(c.mode, 'development');
  assert.equal(c.canonical, null);
  assert.equal(c.secureCookies, false);
  assert.equal(c.bindHost, '127.0.0.1');
  assert.equal(c.port, 3000);
});

test('canonical origin is parsed to origin/host/secure and drives cookie security', () => {
  const c = loadConfig({ AIVORA_CANONICAL_ORIGIN: 'https://store.terminow.online' });
  assert.equal(c.canonical.origin, 'https://store.terminow.online');
  assert.equal(c.canonical.host, 'store.terminow.online');
  assert.equal(c.canonical.secure, true);
  assert.equal(c.secureCookies, true);
});

test('malformed or non-origin canonical values are rejected', () => {
  assert.throws(() => loadConfig({ AIVORA_CANONICAL_ORIGIN: 'not a url' }), /valid URL/);
  assert.throws(() => loadConfig({ AIVORA_CANONICAL_ORIGIN: 'ftp://x' }), /http/);
  assert.throws(() => loadConfig({ AIVORA_CANONICAL_ORIGIN: 'https://x/path' }), /origin only/);
  assert.throws(() => loadConfig({ AIVORA_CANONICAL_ORIGIN: 'https://u:p@x' }), /origin only/);
});

test('production fails safe without https origin and trusted proxy', () => {
  assert.throws(() => loadConfig({ AIVORA_ENV: 'production' }), /required in production/);
  assert.throws(() => loadConfig({ AIVORA_ENV: 'production', AIVORA_CANONICAL_ORIGIN: 'http://x' }), /must be https/);
  assert.throws(() => loadConfig({ AIVORA_ENV: 'production', AIVORA_CANONICAL_ORIGIN: 'https://x' }), /TRUST_PROXY/);
  assert.throws(() => loadConfig({ AIVORA_ENV: 'production', AIVORA_CANONICAL_ORIGIN: 'https://x', AIVORA_TRUST_PROXY: '1', AIVORA_BIND_HOST: '0.0.0.0' }), /loopback/);
  const ok = loadConfig({ AIVORA_ENV: 'production', AIVORA_CANONICAL_ORIGIN: 'https://store.terminow.online', AIVORA_TRUST_PROXY: '1' });
  assert.equal(ok.mode, 'production'); assert.equal(ok.secureCookies, true); assert.equal(ok.trustProxy, true);
});

test('invalid PORT is rejected', () => {
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
});
