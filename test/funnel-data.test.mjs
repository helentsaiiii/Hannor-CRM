/**
 * Funnel math, normalization counts, merge, client panel, and priority.
 * The production backup is read from CRM_BACKUP and is never written into the repo.
 * Emulator checks run only when FIREBASE_DATABASE_EMULATOR_HOST is set.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from '/tmp/jsdom-test/node_modules/jsdom/lib/api.js';

const backupPath = process.env.CRM_BACKUP;
assert.ok(backupPath, 'CRM_BACKUP must point at a local export');
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const data = backup.data || backup;

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .replace(/<script\s+src="[^"]*"><\/script>/g, '')
  .replace(/initDate\(\);[\s\S]*?initFirebase\(\);/, '/* boot skipped */');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/' });
const w = dom.window;
w.fetch = () => { throw new Error('network disabled'); };
w.save = () => {};
w.showToast = () => {};

const year = { start: '2026-01-01', end: '2026-12-31' };
const q4 = { start: '2026-10-01', end: '2026-12-31' };
const all = w.computeFunnel(data, year, '');
const q4n = w.computeFunnel(data, q4, '');
assert.deepEqual([...all].map(s => s.ever), [115, 59, 7, 4]);
assert.deepEqual([...all].map(s => s.current), [26, 8, 0, 4]);
assert.deepEqual([...all].map(s => s.conv), [null, 51, 12, 57]);
assert.deepEqual([...q4n].map(s => s.ever), [16, 4, 0, 1]);

const norm = w.normalizeCrm(data);
assert.equal(norm.summary.titles, 10);
assert.equal(norm.summary.targets, 29);
assert.equal(norm.summary.counts, 31);
assert.equal(norm.summary.interviews, 7);
assert.equal(norm.summary.statuses, 0);
assert.equal(norm.summary.priorities, 0);
assert.equal(norm.data.candidates.length, data.candidates.length);
assert.equal(norm.data.candidates[0].name, data.candidates[0].name);

const remote = {
  candidates: [{ id: 1, name: 'A', note: 'old' }, { id: 2, name: 'B', note: 'from-other' }],
  positions: [{ id: 9, client: 'C', title: 'T', priority: '高', candidates: 0 }],
  currentUser: 'keep-remote'
};
const loaded = {
  candidates: [{ id: 1, name: 'A', note: 'old' }, { id: 2, name: 'B', note: 'stale' }],
  positions: [{ id: 9, client: 'C', title: 'T', priority: '高', candidates: 0 }],
  currentUser: 'session'
};
const base = JSON.stringify(w.snapshotForDelta(loaded));
const local = JSON.parse(JSON.stringify(loaded));
local.candidates[0].note = 'edited-here';
local.currentUser = 'session';
const delta = w.computeDelta(local, base);
assert.deepEqual([...delta.candidates.changed], ['1']);
assert.deepEqual([...delta.candidates.removed], []);
const merged = w.applyDelta(remote, local, delta);
assert.equal(merged.candidates.find(c => c.id === 1).note, 'edited-here');
assert.equal(merged.candidates.find(c => c.id === 2).note, 'from-other');
assert.equal(merged.positions[0].title, 'T');
assert.equal(merged.currentUser, 'keep-remote');

assert.equal(w.normalizePriority('High'), '高');
assert.equal(w.normalizePriority('high'), '高');
assert.equal(w.normalizePriority('中'), '中');
assert.equal(w.normalizePriority(''), '中');
assert.equal(w.normalizePriority('低'), '低');

w.eval('S').positions = [
  { id: 3, client: 'Acme', title: 'Role <img src=x>', status: '搜尋中', priority: 'High', openDate: '2026-01-01', lastUpdate: '2026-01-02', owner: 'O', headcount: '1', note: '' }
];
w.eval('S').candidates = [
  { id: 8, name: 'Pat <script>', owner: 'O', status: '履歷推薦', positionId: 3, company: '', expsalary: '', posHistory: [
    { posId: 3, status: '履歷推薦', posClient: 'OldCo', posTitle: 'Old title', logs: [{ date: '2026-11-01', status: '履歷推薦', time: '09:00' }] }
  ] }
];
w.eval('S').clients = [{ id: 4, name: 'Acme', industry: '半導體', rel: '合作中', taxid: '000', note: '備註<script>', extraField: 'keep-me <b>', contacts: [{ name: 'C', title: 'HR', info: '0912000000' }] }];
const document = w.document;
w.renderPosTable();
const row = document.querySelector('#posTable tr');
assert.ok(row.textContent.includes('Role <img src=x>'));
assert.equal(row.querySelector('img'), null);
assert.equal(row.textContent.includes('1'), true);
assert.equal(row.querySelector('select[aria-label="優先"]').value, '高');
w.eval('S').positions[0].title = 'Role stays';
w.setPositionPriority(3, '低');
assert.equal(w.eval('S').positions[0].priority, '低');
assert.equal(w.eval('S').positions[0].title, 'Role stays');
w.renderPosTable();
if (document.getElementById('posPriorityFilter')) {
  document.getElementById('posPriorityFilter').value = '高';
  w.renderPosTable();
  assert.equal(document.querySelectorAll('#posTable tr.clickable').length, 0);
  document.getElementById('posPriorityFilter').value = '低';
  w.renderPosTable();
  assert.equal(document.querySelectorAll('#posTable tr.clickable').length, 1);
}

w.openClientPanel(4);
const panel = document.getElementById('clientPanel');
assert.equal(panel.querySelector('script'), null);
assert.ok(panel.textContent.includes('Acme'));
assert.ok(panel.textContent.includes('keep-me <b>'));
assert.ok(panel.innerHTML.includes('&lt;b&gt;'));
assert.ok(panel.textContent.includes('備註<script>'));
assert.ok(panel.textContent.includes('Pipeline 1 筆'));
assert.ok(panel.textContent.includes('Role stays'));

let timerId = w.setTimeout(() => {}, 0);
while (timerId > 0) { w.clearTimeout(timerId); w.clearInterval(timerId); timerId -= 1; }

if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const root = process.env.FIREBASE_TEST_MODULES || '/tmp/fb-rules';
  const require = createRequire(pathToFileURL(root + '/package.json'));
  const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
  const rules = fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
  const testEnv = await initializeTestEnvironment({ projectId: 'demo-hannor-rules', database: { rules } });
  try {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await ctx.database().ref('data').set(data);
    });
    const helen = testEnv.authenticatedContext('helen', {
      email: 'helen.tsai@hannortw.com', email_verified: false
    }).database();
    const snap = await assertSucceeds(helen.ref('data/candidates').once('value'));
    const val = snap.val();
    const n = Array.isArray(val) ? val.filter(Boolean).length : Object.keys(val || {}).length;
    assert.equal(n, data.candidates.length);
    const pos = await assertSucceeds(helen.ref('data/positions').once('value'));
    const pv = pos.val();
    const pn = Array.isArray(pv) ? pv.filter(Boolean).length : Object.keys(pv || {}).length;
    assert.equal(pn, data.positions.length);
    const stranger = testEnv.authenticatedContext('nope', {
      email: 'other@example.com', email_verified: true
    }).database();
    await assertFails(stranger.ref('data/candidates').once('value'));
  } finally {
    await testEnv.cleanup();
  }
}

console.log('funnel-data.test.mjs: ok');
