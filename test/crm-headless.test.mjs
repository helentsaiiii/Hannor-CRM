/**
 * Headless checks for the Hannor CRM page.
 * Does not connect to Firebase and does not write production data.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from '/tmp/jsdom-test/node_modules/jsdom/lib/api.js';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .replace(/<script\s+src="[^"]*"><\/script>/g, '')
  .replace(/initDate\(\);[\s\S]*?initFirebase\(\);/, '/* boot skipped: no Firebase, no production write */');

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/' });
const w = dom.window;
const document = w.document;

w.fetch = () => { throw new Error('network disabled'); };
const saves = [];
w.save = function () {
  saves.push(JSON.parse(JSON.stringify(w.eval('S'))));
};
w.showToast = () => {};
w.renderSchedule = () => {};
w.updateScheduleBadge = () => {};
w.renderDashboard = () => {};
w.renderStats = () => {};
w.renderPartner = () => {};
w.render = () => {};

function S() { return w.eval('S'); }
function setCandidates(list) {
  w.eval('S').candidates = list;
  w.eval('S').currentUser = '';
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

function kasper() {
  return {
    id: 42,
    name: 'Kasper Huang',
    company: 'Example Co',
    owner: 'Helen Tsai',
    status: '面試-1st',
    positionId: 101,
    interviewDate: '2026-11-25',
    interviewTime: '10:00',
    interviewNote: '現場面試，竹東；面試官 HR Michael Han + Operation manager',
    logs: [{ date: '2026-11-01', time: '09:00', text: '舊溝通：已電話確認意願' }],
    contactLogs: [{ date: '2026-10-01', time: '08:00', text: 'keep-contact', owner: 'Helen' }],
    interviews: [{ round: '面試-1st', date: '2026-11-25', time: '10:00', note: '現場面試，竹東；面試官 HR Michael Han + Operation manager' }],
    lastStatusDate: '2026-11-20',
    lastStatusTime: '15:00',
    secretKeep: 'do-not-drop',
    posHistory: [
      {
        posId: 101, posClient: '亮紫科技', posTitle: 'Sourcing & Material Readiness Specialist',
        status: '面試-1st', date: '2026-11-10', note: '亮紫備註',
        logs: [{ date: '2026-11-20', time: '15:00', status: '面試-1st', note: '' }]
      },
      {
        posId: 102, posClient: 'DIS', posTitle: 'Supply Chain planner',
        status: '履歷推薦', date: '2026-11-01', note: 'DIS備註',
        logs: [{ date: '2026-11-18', time: '11:00', status: '履歷推薦', note: '' }]
      }
    ]
  };
}

const positions = [
  { id: 101, client: '亮紫科技', title: 'Sourcing & Material Readiness Specialist', status: '搜尋中' },
  { id: 102, client: 'DIS', title: 'Supply Chain planner', status: '搜尋中' }
];

// ── migration + independent pipelines ──
{
  const c = kasper();
  const logsBefore = clone(c.posHistory.map(h => h.logs));
  const liang = w.resolvePipelineInterview(c, c.posHistory[0]);
  const dis = w.resolvePipelineInterview(c, c.posHistory[1]);
  assert.equal(liang.date, '2026-11-25');
  assert.equal(liang.time, '10:00');
  assert.equal(liang.note, c.interviewNote);
  assert.equal(liang.fromLegacy, true);
  assert.equal(dis.date, '');
  assert.equal(dis.time, '');
  assert.equal(dis.note, '');
  assert.equal(c.posHistory[0].interviewDate, undefined, 'read fallback must not write');
  assert.deepEqual(c.posHistory.map(h => h.logs), logsBefore);

  const moved = w.materializeCandidateInterview(c);
  assert.equal(moved, true);
  assert.equal(c.posHistory[0].interviewDate, '2026-11-25');
  assert.equal(c.posHistory[0].interviewTime, '10:00');
  assert.equal(c.posHistory[0].interviewNote, c.interviewNote);
  assert.equal(c.posHistory[1].interviewDate, undefined);
  assert.equal(c.interviewDate, '2026-11-25', 'candidate-level value is kept');
  assert.equal(c.interviewTime, '10:00');
  assert.equal(c.interviewNote.includes('竹東'), true);
  assert.deepEqual(c.posHistory.map(h => h.logs), logsBefore);
  assert.equal(c.secretKeep, 'do-not-drop');
  assert.equal(c.contactLogs[0].text, 'keep-contact');
}

{
  const c = kasper();
  w.applyPipelineEdit(c, 102, {
    idate: '2026-12-01', itime: '15:30', inote: '視訊 DIS only',
    snote: 'DIS備註', logText: 'DIS pipeline note', logDate: '2026-11-11', logTime: '10:30'
  });
  const liang = c.posHistory[0];
  const dis = c.posHistory[1];
  assert.equal(liang.interviewDate, '2026-11-25');
  assert.equal(liang.interviewTime, '10:00');
  assert.equal(liang.interviewNote.includes('竹東'), true);
  assert.equal(dis.interviewDate, '2026-12-01');
  assert.equal(dis.interviewTime, '15:30');
  assert.equal(dis.interviewNote, '視訊 DIS only');
  assert.equal(dis.commLogs.length, 1);
  assert.equal(dis.commLogs[0].text, 'DIS pipeline note');
  assert.equal(dis.commLogs[0].date, '2026-11-11');
  assert.equal(dis.commLogs[0].time, '10:30');
  assert.equal(liang.commLogs, undefined);
  assert.equal(c.logs.length, 1, 'legacy candidate logs are not overwritten');
  assert.equal(c.logs[0].text, '舊溝通：已電話確認意願');
  assert.deepEqual(liang.logs, kasper().posHistory[0].logs);
  assert.deepEqual(dis.logs, kasper().posHistory[1].logs);
  assert.equal(c.interviewDate, '2026-11-25');

  w.applyPipelineEdit(c, 101, {
    idate: '2026-11-26', itime: '11:00', inote: '亮紫改期',
    snote: '亮紫備註', logText: '亮紫 only', logDate: '2026-11-12', logTime: '09:00'
  });
  assert.equal(c.posHistory[1].interviewNote, '視訊 DIS only');
  assert.equal(c.posHistory[1].commLogs[0].text, 'DIS pipeline note');
  assert.equal(c.posHistory[0].interviewNote, '亮紫改期');
  assert.equal(c.posHistory[0].commLogs[0].text, '亮紫 only');
  assert.deepEqual(c.posHistory[1].logs, kasper().posHistory[1].logs);
}

{
  const older = { posId: 1, status: '面試-1st', date: '2026-10-01', logs: [{ date: '2026-10-01', time: '09:00', status: '面試-1st' }] };
  const newer = { posId: 2, status: '面試-2nd', date: '2026-11-02', logs: [{ date: '2026-11-10', time: '18:00', status: '面試-2nd' }] };
  const c = {
    interviewDate: '2026-11-25', interviewTime: '10:00', interviewNote: 'shared-legacy',
    posHistory: [older, newer]
  };
  const target = w.pickInterviewMigrationTarget(c);
  assert.equal(target.posId, 2);
  assert.equal(w.resolvePipelineInterview(c, older).date, '');
  assert.equal(w.resolvePipelineInterview(c, newer).date, '2026-11-25');
  w.materializeCandidateInterview(c);
  assert.equal(older.interviewDate, undefined);
  assert.equal(newer.interviewDate, '2026-11-25');
  assert.equal(c.interviewNote, 'shared-legacy');
}

{
  const c = {
    interviewDate: '2026-11-25', interviewTime: '10:00', interviewNote: 'legacy-only',
    logs: [{ date: '2026-01-01', time: '00:00', text: 'old note' }],
    posHistory: [
      { posId: 1, status: '履歷推薦', logs: [{ date: '2026-11-01', time: '09:00', status: '履歷推薦' }] },
      { posId: 2, status: '履歷推薦', logs: [{ date: '2026-11-02', time: '09:00', status: '履歷推薦' }] }
    ]
  };
  assert.equal(w.materializeCandidateInterview(c), false);
  assert.equal(c.interviewDate, '2026-11-25');
  assert.equal(c.posHistory[0].interviewDate, undefined);
  assert.equal(c.posHistory[1].interviewDate, undefined);
  const legacy = w.candidateLegacyInterview(c);
  assert.equal(legacy.date, '2026-11-25');
  assert.equal(legacy.note, 'legacy-only');
  assert.equal(w.resolvePipelineInterview(c, c.posHistory[0]).date, '');
  assert.equal(w.resolvePipelineInterview(c, c.posHistory[1]).date, '');
}

{
  const old = kasper();
  const form = { name: 'Kasper Huang', phone: '0912000000', note: 'updated note', lastUpdated: '2026-11-11' };
  w.mergeCandidateFields(old, form);
  assert.equal(old.phone, '0912000000');
  assert.equal(old.note, 'updated note');
  assert.equal(old.contactLogs[0].text, 'keep-contact');
  assert.equal(old.lastStatusDate, '2026-11-20');
  assert.equal(old.lastStatusTime, '15:00');
  assert.equal(old.secretKeep, 'do-not-drop');
  assert.equal(old.interviews[0].round, '面試-1st');
  assert.equal(old.posHistory.length, 2);
  assert.equal(old.interviewDate, '2026-11-25', 'legacy interview fields are not deleted');
  assert.equal(old.posHistory[0].interviewTime, '10:00');
}

assert.equal(w.escHtml(`<img src=x onerror=alert(1)>&"'`), '&lt;img src=x onerror=alert(1)&gt;&amp;&quot;&#39;');

// ── rendered pipeline rows stay independent, including after refresh ──
{
  S().positions = positions;
  const c = kasper();
  setCandidates([c]);
  w.renderPipeline();
  const rows = [...document.querySelectorAll('tr[data-pipe]')];
  assert.equal(rows.length, 2);
  const liangRow = document.querySelector('tr[data-pipe="42-101"]');
  const disRow = document.querySelector('tr[data-pipe="42-102"]');
  assert.ok(liangRow.textContent.includes('2026/11/25'));
  assert.ok(liangRow.textContent.includes('現場面試，竹東'));
  assert.equal(disRow.textContent.includes('現場面試'), false);
  assert.equal(disRow.textContent.includes('2026/11/25'), false);
  const ids = [...document.querySelectorAll('[id^="pe-log-"]')].map(el => el.id);
  assert.deepEqual(ids.sort(), ['pe-log-42-101', 'pe-log-42-102']);
  assert.equal(document.getElementById('pe-idate-42-101').value, '2026-11-25');
  assert.equal(document.getElementById('pe-idate-42-102').value, '');
  assert.ok(document.body.textContent.includes('舊溝通：已電話確認意願'));

  document.getElementById('pe-log-42-102').value = '只記在 DIS';
  document.getElementById('pe-idate-42-102').value = '2026-12-02';
  document.getElementById('pe-itime-42-102').value = '16:00';
  document.getElementById('pe-inote-42-102').value = 'DIS 獨立地點';
  const before = saves.length;
  w.savePipeEdit(42, 102);
  assert.equal(saves.length, before + 1);
  assert.equal(w.fbDb, undefined);
  const saved = saves.at(-1);
  const sc = saved.candidates[0];
  assert.equal(sc.posHistory.find(h => h.posId === 102).commLogs.at(-1).text, '只記在 DIS');
  assert.equal(sc.posHistory.find(h => h.posId === 102).interviewNote, 'DIS 獨立地點');
  assert.equal(sc.posHistory.find(h => h.posId === 101).interviewNote.includes('竹東'), true);
  assert.equal((sc.posHistory.find(h => h.posId === 101).commLogs || []).some(l => l.text === '只記在 DIS'), false);
  assert.equal(sc.interviewDate, '2026-11-25');
  assert.equal(sc.secretKeep, 'do-not-drop');
  assert.ok(JSON.stringify(saved).includes('只記在 DIS'));
  assert.equal(JSON.stringify(saved).includes('firebasedatabase.app'), false);

  w.renderPipeline();
  const disAgain = document.querySelector('tr[data-pipe-edit="42-102"]');
  const liangAgain = document.querySelector('tr[data-pipe-edit="42-101"]');
  assert.ok(disAgain.textContent.includes('只記在 DIS'));
  assert.equal(liangAgain.textContent.includes('只記在 DIS'), false);
  assert.ok(liangAgain.textContent.includes('舊溝通：已電話確認意願'));
}

// ── position card: no leaked template, only name / salary / badge ──
{
  S().positions = [{
    id: 7, client: 'ASM', title: 'Manager I, Sales - PEALD', status: '搜尋中',
    priority: '高', openDate: '2026-11-06', lastUpdate: '2026-11-06', owner: 'Helen Tsai', note: '來源備註'
  }];
  S().candidates = [
    {
      id: 8, name: 'Eddie Chen', expsalary: '190', status: '履歷推薦', positionId: 7,
      posHistory: [{ posId: 7, status: '履歷推薦', posClient: 'ASM', posTitle: 'Manager I, Sales - PEALD', logs: [] }]
    },
    {
      id: 9, name: 'Pat <img src=x onerror=alert(1)>', expsalary: '200', status: '已成交', positionId: 7,
      posHistory: [{ posId: 7, status: '已成交', logs: [] }]
    }
  ];
  w.eval('openProjId = 7');
  w.renderProjPanel();
  const cards = [...document.querySelectorAll('#pp-candidates .pipe-card')];
  assert.equal(cards.length, 2);
  const eddie = cards[0].textContent.replace(/\s+/g, ' ').trim();
  assert.equal(eddie, 'Eddie Chen 履歷推薦 💰 期望 190萬');
  assert.equal(cards[0].textContent.includes('includes(displayStatus)'), false);
  assert.equal(cards[0].innerHTML.includes('includes(displayStatus)'), false);
  assert.equal(cards[0].querySelector('img'), null);
  const placed = cards[1];
  assert.equal(placed.getAttribute('style').includes('rgba(220,53,69,.10)'), true);
  assert.equal(placed.querySelector('img'), null);
  assert.ok(placed.textContent.includes('Pat <img src=x onerror=alert(1)>'));
  assert.ok(placed.innerHTML.includes('&lt;img'));
  assert.equal(document.getElementById('pp-candidates').textContent.includes('includes(displayStatus)'), false);
}

// ── candidate detail escapes a hostile name and resume-like note ──
{
  const nasty = kasper();
  nasty.name = '<img src=x onerror=alert(1)>';
  nasty.note = '履歷<script>alert(1)</script>';
  nasty.company = 'Co & Sons';
  nasty.skills = '焊錫<script>alert(1)</script>';
  nasty.edu = '台大<img src=x>';
  setCandidates([nasty]);
  S().positions = positions;
  w.openDetail(42);
  assert.equal(document.querySelector('#dp-contact img, #dp-history img, #dp-pro script, #detailPanel script'), null);
  assert.ok(document.getElementById('dp-contact').textContent.includes('<img src=x onerror=alert(1)>'));
  assert.ok(document.getElementById('dp-contact').innerHTML.includes('&lt;img'));
  assert.ok(document.getElementById('dp-role').textContent.includes('Co & Sons'));
  assert.ok(document.getElementById('dp-pro').textContent.includes('焊錫<script>alert(1)</script>'));
  assert.ok(document.getElementById('dp-pro').innerHTML.includes('&lt;script&gt;'));
  assert.ok(document.getElementById('dp-basic').textContent.includes('台大<img src=x>'));
  assert.equal(document.getElementById('dp-note').value, nasty.note);
}

// ── Export JSON backup downloads the full data node ──
{
  const files = [];
  w.URL.createObjectURL = (blob) => { files.push(blob); return 'blob:local'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {};
  S().extraNode = { kept: true };
  document.getElementById('btn-export-json').click();
  assert.equal(files.length, 1);
  const text = await new Promise((resolve, reject) => {
    const reader = new w.FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(files[0]);
  });
  const data = JSON.parse(text);
  assert.equal(data.extraNode.kept, true);
  assert.ok(Array.isArray(data.candidates));
  assert.ok(Array.isArray(data.positions));
  assert.equal(data.candidates.find(c => c.id === 42).secretKeep, 'do-not-drop');
  assert.equal(data.candidates.find(c => c.id === 42).contactLogs[0].text, 'keep-contact');
  const headerBtn = document.getElementById('btn-export-json-header');
  assert.equal(headerBtn.textContent.trim(), 'Export JSON backup');
  assert.equal(document.getElementById('btn-export-json').textContent.trim(), 'Export JSON backup');
}

let timerId = w.setTimeout(() => {}, 0);
while (timerId > 0) {
  w.clearTimeout(timerId);
  w.clearInterval(timerId);
  timerId -= 1;
}
console.log('crm-headless.test.mjs: all assertions passed');
