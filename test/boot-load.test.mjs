/**
 * Cold-load races for the loading screen, plus the run #2 database
 * operations under the published allow-list rules (emulator only).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from '/tmp/jsdom-test/node_modules/jsdom/lib/api.js';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .replace(/<script\s+src="[^"]*"><\/script>/g, '');

function sampleData(){
  return {
    candidates: [{
      id: 1, name: '合成人選', status: '履歷推薦', owner: 'Helen Tsai',
      addDate: '2026-11-01', company: 'Co', role: 'R', phone: '', email: '',
      interviewDate: '', interviewTime: '', interviewNote: '',
      posHistory: [{ posId: 9, posClient: '客戶A', posTitle: '職位A', status: '履歷推薦', date: '2026-11-01', note: '', logs: [{ date: '2026-11-01', time: '09:00', status: '履歷推薦' }] }]
    }],
    positions: [{ id: 9, client: '客戶A', title: '職位A', status: '搜尋中', priority: '高', candidates: 0, openDate: '2026-11-01', lastUpdate: '2026-11-01', owner: 'Helen Tsai', headcount: '1', note: '', jd: '', interviewProcess: '', location: '', salrange: '' }],
    clients: [{ id: 3, name: '客戶A', industry: '半導體', rel: '合作中', taxid: '', addr: '', url104: '', owner: '', placed: 0, lastContact: '', addDate: '2026-11-01', note: '' }],
    deals: [], actions: [], attendance: [], contracts: [],
    users: ['Helen Tsai'], userMeta: { 'Helen Tsai': { email: 'helen.tsai@hannortw.com' } },
    partnerConsultants: [], currentUser: ''
  };
}

function boot(scenario){
  const listened = [];
  let currentUser = scenario.user === undefined ? null : scenario.user;
  const auth = {
    setPersistence(){ return scenario.persistence || Promise.resolve(); },
    onAuthStateChanged(cb){
      scenario.listened = true;
      if(scenario.neverAuth) return ()=>{};
      const delay = scenario.authDelay || 0;
      setTimeout(()=>cb(currentUser), delay);
      return ()=>{};
    },
    get currentUser(){ return currentUser; },
    signInWithEmailAndPassword(){ return Promise.resolve(); },
    signOut(){ currentUser=null; return Promise.resolve(); }
  };
  const firebase = {
    apps: [],
    initializeApp(){ if(!this.apps.length) this.apps.push({}); },
    auth: ()=>auth,
    database: ()=>({
      ref(path){
        listened.push(path);
        return {
          once(){
            if(scenario.dataError) return Promise.reject(scenario.dataError);
            return new Promise(resolve=>setTimeout(()=>resolve({ val:()=> path==='data' ? scenario.data : null }), scenario.dataDelay||0));
          },
          on(event, cb, cancel){
            listened.push('on:'+path);
            if(scenario.listenError && cancel) cancel(scenario.listenError);
            return ()=>{};
          },
          off(){},
          set(v){ return Promise.resolve(v); },
          transaction(update, done){
            try{
              const next = update(scenario.data);
              if(done) done(null, true);
              return Promise.resolve({ committed:true, snapshot:{ val:()=>next } });
            }catch(e){
              if(done) done(e, false);
              return Promise.reject(e);
            }
          }
        };
      }
    })
  };
  const dom = new JSDOM(page, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(window){
      window.__BOOT_TIMEOUT_MS = scenario.timeout || 400;
      window.firebase = firebase;
    }
  });
  return { dom, window: dom.window, listened };
}

function loaderVisible(w){
  return w.document.getElementById('loadingScreen').style.display !== 'none';
}
function loginVisible(w){
  const el = w.document.getElementById('loginScreen');
  return !el.classList.contains('hidden') && !loaderVisible(w);
}

const sleep = ms => new Promise(r=>setTimeout(r, ms));

// 1) Signed out, setPersistence never resolves. Login must appear without waiting for it.
{
  const hangs = new Promise(()=>{});
  const { window: w } = boot({ user: null, persistence: hangs, authDelay: 10, timeout: 2000 });
  await sleep(80);
  assert.equal(loginVisible(w), true, 'signed-out cold load shows login even if setPersistence hangs');
  assert.equal(loaderVisible(w), false);
  w.close();
}

// 2) Three more signed-out cold loads.
for(let i=0;i<3;i++){
  const { window: w } = boot({ user: null, persistence: new Promise(()=>{}), authDelay: 5, timeout: 2000 });
  await sleep(40);
  assert.equal(loginVisible(w), true, 'repeat signed-out load '+i);
  w.close();
}

// 3) Signed in, persistence hangs, data returns. App must show.
{
  const { window: w } = boot({
    user: { uid:'u1', email:'helen.tsai@hannortw.com', displayName:'Helen Tsai' },
    persistence: new Promise(()=>{}),
    data: sampleData(),
    authDelay: 5,
    dataDelay: 20,
    timeout: 2000
  });
  await sleep(120);
  assert.equal(loaderVisible(w), false, 'signed-in load hides loader');
  assert.equal(w.document.getElementById('loginScreen').classList.contains('hidden'), true);
  assert.equal(w.document.getElementById('dp-name') ? true : w.document.body.textContent.includes('本週總覽') || w.document.body.textContent.includes('Weekly'), true);
  assert.equal(w.eval('S').candidates.length, 1);
  w.close();
}

// 4) Three signed-in cold loads.
for(let i=0;i<3;i++){
  const { window: w } = boot({
    user: { uid:'u1', email:'helen.tsai@hannortw.com' },
    persistence: new Promise(()=>{}),
    data: sampleData(),
    authDelay: 0,
    dataDelay: 10,
    timeout: 2000
  });
  await sleep(80);
  assert.equal(loaderVisible(w), false, 'repeat signed-in load '+i);
  assert.equal(w.eval('S').candidates[0].status, '履歷推薦');
  w.close();
}

// 5) Auth never calls back and persistence hangs: timeout reveals login and an error, not a spinner.
{
  const { window: w } = boot({ neverAuth: true, persistence: new Promise(()=>{}), timeout: 200 });
  await sleep(350);
  assert.equal(loginVisible(w), true);
  assert.match(w.document.getElementById('loginError').textContent, /逾時/);
  w.close();
}

// 6) Signed in, database never answers: visible error, not an endless 載入中.
{
  const { window: w } = boot({
    user: { uid:'u1', email:'helen.tsai@hannortw.com' },
    dataDelay: 5000,
    timeout: 200
  });
  await sleep(400);
  const detail = w.document.getElementById('loadingDetail');
  assert.equal(detail.style.display, 'block');
  assert.match(detail.textContent, /逾時|無法讀取/);
  assert.notEqual(w.document.getElementById('loadingMessage').textContent, '載入中…');
  assert.equal(w.document.getElementById('loadingRetry').style.display, 'inline-block');
  w.close();
}

// 7) Permission denied resolves to an error, not a spinner.
{
  const { window: w } = boot({
    user: { uid:'u2', email:'other@example.com' },
    dataError: Object.assign(new Error('permission_denied'), { code:'PERMISSION_DENIED' }),
    timeout: 2000
  });
  await sleep(40);
  assert.match(w.document.getElementById('loadingDetail').textContent, /權限/);
  w.close();
}

// 8) Slow but successful read still opens the app.
{
  const { window: w } = boot({
    user: { uid:'u1', email:'helen.tsai@hannortw.com' },
    data: sampleData(),
    dataDelay: 150,
    timeout: 1000
  });
  await sleep(40);
  assert.equal(loaderVisible(w), true);
  await sleep(200);
  assert.equal(loaderVisible(w), false);
  w.close();
}

// 9) Run #2 merge + render does not throw on a realistic record, and only listens on allowed paths.
{
  const { window: w, listened } = boot({
    user: { uid:'u1', email:'helen.tsai@hannortw.com' },
    data: sampleData(),
    dataDelay: 5,
    timeout: 2000
  });
  await sleep(60);
  assert.equal(loaderVisible(w), false);
  assert.ok(listened.includes('data'));
  assert.ok(listened.includes('on:data'));
  assert.ok(listened.includes('on:partnerCandidates'));
  assert.equal(listened.includes(''), false);
  assert.equal(listened.includes('/'), false);
  w.eval('S').candidates[0].note = 'edited';
  const delta = w.computeDelta(w.eval('S'), w.eval('_baseJson'));
  assert.ok([...delta.candidates.changed].includes('1'));
  const merged = w.applyDelta(sampleData(), w.eval('S'), delta);
  assert.equal(merged.candidates.find(c=>c.id===1).note, 'edited');
  assert.equal(merged.positions[0].title, '職位A');
  w.close();
}

if(process.env.FIREBASE_DATABASE_EMULATOR_HOST){
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const root = process.env.FIREBASE_TEST_MODULES || '/tmp/fb-rules';
  const require = createRequire(pathToFileURL(root + '/package.json'));
  const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
  const rules = fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
  const testEnv = await initializeTestEnvironment({ projectId: 'demo-hannor-rules', database: { rules } });
  const data = sampleData();
  try{
    await testEnv.withSecurityRulesDisabled(async ctx=>{
      await ctx.database().ref('data').set(data);
      await ctx.database().ref('partnerCandidates').set([]);
    });
    for(let i=0;i<3;i++){
      const db = testEnv.authenticatedContext('helen-'+i, {
        email: 'helen.tsai@hannortw.com', email_verified: false
      }).database();
      const snap = await assertSucceeds(db.ref('data').once('value'));
      assert.equal(snap.val().candidates[0].status, '履歷推薦');
      await assertSucceeds(db.ref('partnerCandidates').once('value'));
      await new Promise((resolve, reject)=>{
        const ref = db.ref('data');
        const cb = s=>{ ref.off('value', cb); resolve(s.val()); };
        ref.on('value', cb, reject);
      });
    }
    const helen = testEnv.authenticatedContext('helen-edit', {
      email: 'helen.tsai@hannortw.com', email_verified: false
    }).database();
    await assertSucceeds(helen.ref('data').transaction(remote=>{
      const base = remote || data;
      const next = JSON.parse(JSON.stringify(base));
      next.candidates[0].note = 'saved-under-rules';
      return next;
    }));
    const after = await helen.ref('data/candidates/0/note').once('value');
    assert.equal(after.val(), 'saved-under-rules');
    const anon = testEnv.unauthenticatedContext().database();
    await assertFails(anon.ref('data').once('value'));
    const stranger = testEnv.authenticatedContext('stranger', {
      email: 'other@example.com', email_verified: true
    }).database();
    await assertFails(stranger.ref('data').once('value'));
  }finally{
    await testEnv.cleanup();
  }
}

console.log('boot-load.test.mjs: ok');
