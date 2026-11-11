/**
 * Checks database.rules.json against the paths index.html actually uses.
 * Runs only against the local Realtime Database emulator. No production writes.
 *
 *   NODE_PATH=/tmp/fb-rules/node_modules node test/database-rules.test.mjs
 * with FIREBASE_DATABASE_EMULATOR_HOST set (firebase emulators:exec does this).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const modulesRoot = process.env.FIREBASE_TEST_MODULES || '/tmp/fb-rules';
const require = createRequire(pathToFileURL(modulesRoot + '/package.json'));
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');

const rules = fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
const ALLOW = [
  'tina.yang.hannor@gmail.com',
  'ivy.hannor@gmail.com',
  'helen.tsai@hannortw.com',
  'ethen.chang@hannortw.com',
];

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-hannor-rules',
  database: { rules },
});

function dbFor(email, { verified = false } = {}) {
  return testEnv.authenticatedContext('uid-' + email, {
    email,
    email_verified: verified,
  }).database();
}

const sampleData = {
  candidates: [{ id: 1, name: 'Kasper Huang', interviewDate: '2026-11-25' }],
  positions: [{ id: 101, client: '亮紫科技', title: 'Sourcing' }],
  clients: [],
  users: ['Helen Tsai'],
};
const samplePartners = [{ id: 99, name: '外包人選', partnerSource: true }];

try {
  for (const email of ALLOW) {
    await testEnv.clearDatabase();
    const db = dbFor(email, { verified: false });
    await assertSucceeds(db.ref('data').set(sampleData));
    const dataSnap = await assertSucceeds(db.ref('data').once('value'));
    assert.equal(dataSnap.val().candidates[0].name, 'Kasper Huang');
    await assertSucceeds(db.ref('partnerCandidates').set(samplePartners));
    const partnerSnap = await assertSucceeds(db.ref('partnerCandidates').once('value'));
    assert.equal(partnerSnap.val()[0].name, '外包人選');
    await assertSucceeds(new Promise((resolve, reject) => {
      const ref = db.ref('data');
      const cb = snap => {
        ref.off('value', cb);
        resolve(snap.val());
      };
      ref.on('value', cb, reject);
    }));
    await assertFails(db.ref('other').set({ nope: true }));
  }

  const anon = testEnv.unauthenticatedContext().database();
  await assertFails(anon.ref('data').once('value'));
  await assertFails(anon.ref('data').set(sampleData));
  await assertFails(anon.ref('partnerCandidates').once('value'));
  await assertFails(anon.ref('partnerCandidates').set(samplePartners));

  const stranger = testEnv.authenticatedContext('stranger', {
    email: 'other@example.com',
    email_verified: true,
  }).database();
  await assertFails(stranger.ref('data').once('value'));
  await assertFails(stranger.ref('data').set(sampleData));
  await assertFails(stranger.ref('partnerCandidates').once('value'));
  await assertFails(stranger.ref('partnerCandidates').set(samplePartners));

  console.log('database-rules.test.mjs: allow-list can read/write data and partnerCandidates without email_verified; others are denied');
} finally {
  await testEnv.cleanup();
}
