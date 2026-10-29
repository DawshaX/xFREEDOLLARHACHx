import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScope, matchAsset } from '../scope.mjs';
import { createAppServer } from '../server.mjs';

const future = new Date(Date.now() + 86400000).toISOString();
const valid = { program: 'Example authorized program', asset: 'https://example.com', authorizationRef: 'DOC-1', expiresAt: future };

test('scope accepts a well-formed future authorization record', () => {
  const result = validateScope(valid);
  assert.equal(result.ok, true);
  assert.equal(result.host, 'example.com');
});
test('scope rejects expired authorization', () => {
  const result = validateScope({ ...valid, expiresAt: '2020-01-01T00:00:00Z' });
  assert.equal(result.ok, false);
});
test('date-only expiry remains valid through the end of the UTC day', () => {
  const result = validateScope({ ...valid, expiresAt: '2030-01-01' }, new Date('2030-01-01T12:00:00Z'));
  assert.equal(result.ok, true);
  const expired = validateScope({ ...valid, expiresAt: '2030-01-01' }, new Date('2030-01-02T00:00:00Z'));
  assert.equal(expired.ok, false);
});
test('scope rejects localhost and IP literals', () => {
  assert.equal(validateScope({ ...valid, asset: 'http://localhost' }).ok, false);
  assert.equal(validateScope({ ...valid, asset: 'http://127.0.0.1' }).ok, false);
});
test('scope rejects embedded credentials and nonstandard ports', () => {
  const withCredentials = new URL('https://example.com');
  withCredentials.username = 'test-user';
  withCredentials.password = 'test-value';
  assert.equal(validateScope({ ...valid, asset: withCredentials.toString() }).ok, false);
  assert.equal(validateScope({ ...valid, asset: 'https://example.com:8443' }).ok, false);
});
test('wildcard matching is limited to one label', () => {
  assert.equal(matchAsset('*.example.com', 'api.example.com'), true);
  assert.equal(matchAsset('*.example.com', 'a.b.example.com'), false);
  assert.equal(matchAsset('*.example.com', 'example.com'), false);
  assert.equal(matchAsset('example.com', 'api.example.com'), false);
});

test('HTTP API is read-only except offline scope validation', async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(base + '/api/health').then((r) => r.json());
    assert.equal(health.networkScanning, false);
    assert.equal(health.legacyRuntime, 'disabled');
    const library = await fetch(base + '/api/library?q=SSRF').then((r) => r.json());
    assert.ok(library.items.some((x) => x.id === 'CWE-918'));
    const scope = await fetch(base + '/api/scope/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid)
    }).then((r) => r.json());
    assert.equal(scope.ok, true);
    const missing = await fetch(base + '/api/terminal/exec', { method: 'POST' });
    assert.equal(missing.status, 404);
    const traversal = await fetch(base + '/../../package.json');
    assert.equal(traversal.status, 404);
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /NOVA/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
