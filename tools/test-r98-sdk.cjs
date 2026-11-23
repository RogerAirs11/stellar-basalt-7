'use strict';
require('./lib/register-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPlatformClient } = require('../src/frontend-kit/platformClient.ts');
const { createMockPlatformClient } = require('../src/frontend-kit/mockPlatformClient.ts');
test('R98 managed profile uses the typed private GET and abort signal', async () => { const calls = []; const signal = new AbortController().signal; const client = createPlatformClient({ transport: async (url, init) => { calls.push({ url, init }); return { profile: { person_id: 7, row_version: 3 } }; } }); const view = await client.modules.directory.managedProfile(7, { signal }); assert.equal(view.profile.row_version, 3); assert.equal(calls[0].url, '/api/directory/persons/7/profile'); assert.equal(calls[0].init.signal, signal); });
test('R98 update transports the exact version and CSRF token without guessing', async () => { const calls = []; const client = createPlatformClient({ transport: async (url, init) => { calls.push({ url, init }); return {}; }, csrfToken: () => 'synthetic-csrf' }); await client.modules.directory.upsertProfile(7, { expected_version: 3, service_categories: ['farrier'], publication_consent: false }); assert.equal(calls[0].init.method, 'PUT'); assert.equal(JSON.parse(calls[0].init.body).expected_version, 3); assert.equal(new Headers(calls[0].init.headers).get('x-csrf-token'), 'synthetic-csrf'); });
test('R98 managed profile rejects invalid IDs before transport', async () => { let sent = 0; const client = createPlatformClient({ transport: async () => { sent++; } }); for (const id of [0, -1, 1.5, NaN])
    assert.throws(() => client.modules.directory.managedProfile(id)); assert.equal(sent, 0); });
test('R98 prototype cannot pretend to save/read a durable private profile', async () => { const mock = createMockPlatformClient(); await assert.rejects(mock.modules.directory.managedProfile(7), error => error.status === 501); const page = await mock.modules.directory.persons(); assert.equal(page.persons[0].province_code, 'IR-23'); });
