/* 현장 IP 기록 — 고로소프트 계정 로그인 + Firestore 저장(오프라인에서도 입력 가능, 연결되면 자동 동기화) */
import { firebaseConfig, SDK } from '/firebase-config.js?v=20261026b';

const STATUS = [
  { k: 'reinstall', label: '재설치 필요' },
  { k: 'ok', label: '정상' },
  { k: 'review', label: '검토 확인' },
];
const SKEYS = STATUS.map(s => s.k);
const SL = Object.fromEntries(STATUS.map(s => [s.k, s.label]));
const PREFIX = 'ipnote_'; // Firestore 컬렉션 이름 앞에 붙는 접두어

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ipNum = ip => ip.split('.').reduce((a, b) => a * 256 + (+b || 0), 0);
const validIp = ip => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip) && ip.split('.').every(n => +n <= 255);
function store(k, v) { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch (e) {} }
function load(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
function show(el, text, kind) { if (!el) return; el.hidden = !text; el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : '') }
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
const fmtDate = s => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); if (!y) return ''; const w = '일월화수목금토'[new Date(y, m - 1, d).getDay()]; return `${m}/${d}(${w})` };
const fmtTime = t => { if (!t) return ''; const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}` };

const S = {
  sites: [], areas: [], lines: [], pcs: [], site: null, areaId: null,
  status: (() => { const v = load('ipnote.status'); return SKEYS.includes(v) ? v : 'ok' })(),
  openPc: null, openLine: null, editArea: null,
};
let db = null, me = { uid: '', name: '' }, unsubs = [];
const area = () => S.areas.find(a => a.id === S.areaId) || null;
const linesOf = aid => S.lines.filter(l => l.areaId === aid).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
const pcsOf = aid => S.pcs.filter(p => p.areaId === aid);

/* ---------- 알림 ---------- */
function toast(text) {
  const c = $('conn'); c.textContent = text; c.classList.add('off');
}
function errText(err) {
  const c = err && err.code;
  if (c === 'permission-denied') return '이 계정에는 저장 권한이 없습니다. 관리자에게 허용을 요청하세요.';
  if (c === 'resource-exhausted') return '사용량 한도를 넘었습니다. 잠시 후 다시 시도하세요.';
  return '저장하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.';
}
function writeErr(el, err) { show(el, errText(err), 'err') }

/* ---------- Firestore 연결 ----------
   오프라인이면 쓰기가 서버 응답을 기다리며 멈추므로, 잠깐만 기다리고 화면은 바로 진행합니다.
   (기기에 저장해 두었다가 연결되면 자동으로 올라갑니다) */
function makeDb(m, fdb) {
  const col = c => m.collection(fdb, PREFIX + c);
  const wait = p => {
    let settled = false;
    p.then(() => { settled = true }, e => { if (settled) return; settled = true; toast(errText(e)) });
    return Promise.race([p, new Promise(r => setTimeout(r, 900))]).then(v => { settled = true; return v });
  };
  const wrap = r => ({
    id: r.id,
    set: d => wait(m.setDoc(r, d)),
    update: d => wait(m.updateDoc(r, d)),
    delete: () => wait(m.deleteDoc(r)),
  });
  const refOf = path => { const [c, id] = path.split('/'); return m.doc(fdb, PREFIX + c, id) };
  return {
    doc: path => wrap(refOf(path)),
    collection: c => ({
      doc: id => wrap(id ? m.doc(col(c), id) : m.doc(col(c))),
      onSnapshot: (next, error) => m.onSnapshot(col(c), { includeMetadataChanges: true },
        s => next({ docs: s.docs.map(d => ({ id: d.id, data: () => d.data() })), metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites } }),
        error),
    }),
    /* 여러 건 삭제·수정을 한 번에(최대 450건씩) */
    async batch(ops) {
      for (let i = 0; i < ops.length; i += 450) {
        const b = m.writeBatch(fdb);
        ops.slice(i, i + 450).forEach(o => {
          if (o.op === 'delete') b.delete(refOf(o.path));
          else b.update(refOf(o.path), o.data);
        });
        await wait(b.commit());
      }
    },
  };
}

/* ---------- 상태 버튼 ---------- */
function renderSeg() {
  $('seg-status').innerHTML = STATUS.map(s => `<button type="button" class="s-${s.k}" data-k="${s.k}" aria-pressed="${S.status === s.k}"><span class="dot"></span>${s.label}</button>`).join('');
}
$('seg-status').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.status = b.dataset.k; store('ipnote.status', S.status); renderSeg() });

/* ---------- 지역 ---------- */
function siteNames() {
  const a = S.sites.map(s => s.name).filter(Boolean);
  S.areas.forEach(x => { if (x.site && !a.includes(x.site)) a.push(x.site) });
  return [...new Set(a)].sort((x, y) => x.localeCompare(y, 'ko'));
}
function syncSel() {
  const names = siteNames();
  if (S.site && !names.includes(S.site)) S.site = null;
  if (!S.site && names.length) { const last = load('ipnote.site'); S.site = names.includes(last) ? last : names[0] }
  if (S.areaId && (!area() || area().site !== S.site)) S.areaId = null;
  if (!S.areaId) { const inSite = S.areas.filter(a => a.site === S.site); if (inSite.length) { const last = load('ipnote.area'); S.areaId = (inSite.find(a => a.id === last) || inSite[0]).id } }
}
function renderSites() {
  const names = siteNames();
  $('site-list').innerHTML = names.length
    ? names.map(n => `<button type="button" class="chip" data-site="${esc(n)}" aria-pressed="${n === S.site}">${esc(n)}<span class="n">${S.areas.filter(a => a.site === n).length}동</span></button>`).join('')
      + (S.site ? `<button type="button" class="ghost" id="btn-site-del" style="color:var(--fail)">"${esc(S.site)}" 삭제</button>` : '')
    : '<div class="note">지역이 없습니다. "+ 지역 추가"로 청주, 부산 같은 지역을 만드세요.</div>';
}
$('site-list').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'btn-site-del') { deleteSite(b); return }
  if (b.dataset.site === undefined) return;
  S.site = b.dataset.site; store('ipnote.site', S.site); S.areaId = null; S.openPc = null; S.openLine = null; $('area-form').hidden = true; renderAll();
});
$('btn-site-new').addEventListener('click', () => { $('site-form').hidden = false; show($('sf-msg'), ''); $('sf-name').value = ''; $('sf-name').focus() });
$('sf-cancel').addEventListener('click', () => { $('site-form').hidden = true; show($('sf-msg'), '') });
$('site-form').addEventListener('submit', async e => {
  e.preventDefault(); if (!db) return;
  const name = $('sf-name').value.trim();
  if (!name) { show($('sf-msg'), '지역 이름을 입력하세요.', 'err'); return }
  if (siteNames().includes(name)) { show($('sf-msg'), `"${name}"은(는) 이미 있습니다.`, 'warn'); return }
  try {
    await db.collection('sites').doc().set({ name, createdAt: Date.now() });
    S.site = name; store('ipnote.site', name); S.areaId = null; $('site-form').hidden = true; show($('sf-msg'), ''); renderAll();
  } catch (err) { writeErr($('sf-msg'), err) }
});
async function deleteSite(btn) {
  const name = S.site; if (!name) return;
  const areas = S.areas.filter(a => a.site === name);
  const ip = areas.reduce((s, a) => s + pcsOf(a.id).length, 0);
  if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = areas.length ? `"${name}" (동 ${areas.length}개, IP ${ip}대) — 한 번 더 누르면 삭제` : `"${name}" — 한 번 더 누르면 삭제`; return }
  btn.disabled = true; btn.textContent = '삭제 중…';
  try {
    const ops = wipeOps(areas);
    S.sites.filter(s => s.name === name).forEach(s => ops.push({ op: 'delete', path: 'sites/' + s.id }));
    await db.batch(ops);
    S.site = null; S.areaId = null; store('ipnote.site'); renderAll();
  } catch (err) { btn.disabled = false; btn.dataset.armed = ''; writeErr($('sf-msg'), err) }
}

/* ---------- 동 ---------- */
function renderAreas() {
  const box = $('area-list');
  $('btn-area-new').hidden = !S.site;
  if (!S.site) { box.innerHTML = ''; return }
  const arr = S.areas.filter(a => a.site === S.site).sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || a.dong.localeCompare(b.dong, 'ko'));
  box.innerHTML = arr.length ? `<div class="chips">${arr.map(a => { const n = pcsOf(a.id).length; return `<button type="button" class="chip" data-id="${a.id}" aria-pressed="${a.id === S.areaId}">${a.date ? `<span class="d">${fmtDate(a.date)}</span>` : ''}${esc(a.dong)}<span class="n">${n}${a.planned ? '/' + a.planned : ''}</span></button>` }).join('')}</div>`
    : `<div class="note">${esc(S.site)}에 등록된 동이 없습니다. "+ 동 추가"로 만드세요.</div>`;
}
$('area-list').addEventListener('click', e => { const b = e.target.closest('button[data-id]'); if (!b) return; S.areaId = b.dataset.id; S.openPc = null; S.openLine = null; store('ipnote.area', S.areaId); renderAll() });

function openAreaForm(a) {
  S.editArea = a ? a.id : null;
  $('af-site-label').textContent = `지역: ${a ? a.site : S.site}`;
  $('af-dong').value = a ? a.dong : '';
  $('af-planned').value = a && a.planned ? a.planned : '';
  $('af-date').value = a ? (a.date || '') : todayStr();
  $('af-del-row').hidden = !a;
  $('af-delete').dataset.armed = ''; $('af-delete').textContent = '동 삭제'; $('af-delete').disabled = false;
  show($('af-msg'), '');
  $('area-form').hidden = false; $(a ? 'af-planned' : 'af-dong').focus();
}
$('btn-area-new').addEventListener('click', () => openAreaForm(null));
$('af-cancel').addEventListener('click', () => { $('area-form').hidden = true });
$('area-form').addEventListener('submit', async e => {
  e.preventDefault(); if (!db) return;
  const ed = S.areas.find(x => x.id === S.editArea);
  const site = ed ? ed.site : S.site, dong = $('af-dong').value.trim();
  const planned = parseInt($('af-planned').value, 10) || 0;
  if (!site) { show($('af-msg'), '먼저 위에서 지역을 고르세요.', 'err'); return }
  if (!dong) { show($('af-msg'), '동 이름을 입력하세요.', 'err'); return }
  if (S.areas.find(a => a.site === site && a.dong === dong && a.id !== S.editArea)) { show($('af-msg'), '같은 지역에 같은 이름의 동이 이미 있습니다.', 'err'); return }
  const body = { site, dong, planned, date: $('af-date').value || '' };
  try {
    if (S.editArea) await db.doc('areas/' + S.editArea).update(body);
    else { const ref = db.collection('areas').doc(); await ref.set({ ...body, prefix: '', createdAt: Date.now() }); S.areaId = ref.id; store('ipnote.area', ref.id) }
    $('area-form').hidden = true; renderAll();
  } catch (err) { writeErr($('af-msg'), err) }
});
function wipeOps(areas) {
  const ops = [];
  areas.forEach(a => {
    pcsOf(a.id).forEach(p => ops.push({ op: 'delete', path: 'pcs/' + p.id }));
    linesOf(a.id).forEach(l => ops.push({ op: 'delete', path: 'lines/' + l.id }));
    ops.push({ op: 'delete', path: 'areas/' + a.id });
  });
  return ops;
}
$('af-delete').addEventListener('click', async () => {
  const btn = $('af-delete'); const a = S.areas.find(x => x.id === S.editArea); if (!a) return;
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = `${a.dong} (라인 ${linesOf(a.id).length}개, IP ${pcsOf(a.id).length}대) — 한 번 더 누르면 삭제`; return }
  btn.disabled = true; btn.textContent = '삭제 중…';
  try { await db.batch(wipeOps([a])); S.areaId = null; store('ipnote.area'); $('area-form').hidden = true; renderAll() }
  catch (err) { btn.disabled = false; btn.dataset.armed = ''; writeErr($('af-msg'), err) }
});

/* ---------- 요약 ---------- */
function renderSummary() {
  const a = area(); const box = $('summary');
  if (!a) { box.hidden = true; return }
  box.hidden = false;
  const ps = pcsOf(a.id); const c = { reinstall: 0, ok: 0, review: 0 }; ps.forEach(p => c[p.status in c ? p.status : 'review']++);
  const total = Math.max(a.planned || 0, ps.length) || 1;
  const sitePs = S.pcs.filter(p => S.areas.find(x => x.id === p.areaId)?.site === a.site);
  const sitePlan = S.areas.filter(x => x.site === a.site).reduce((s, x) => s + (x.planned || 0), 0);
  box.innerHTML = `
    <div class="sum-head">
      <div><div class="note">${esc(a.site)}${a.prefix ? ` · <span class="mono">${esc(a.prefix)}x</span>` : ''}</div><div class="sum-title">${esc(a.dong)}${a.date ? ` <span class="note" style="font-weight:500">· ${fmtDate(a.date)} 작업</span>` : ''}</div></div>
      <div style="text-align:right"><span class="big">${ps.length}</span><span class="muted mono"> / ${a.planned || '—'}대</span><div class="note">기록 / 계획</div></div>
    </div>
    <div class="bar" role="img" aria-label="정상 ${c.ok}, 검토 확인 ${c.review}, 재설치 필요 ${c.reinstall}">
      ${['ok', 'review', 'reinstall'].map(k => `<span class="s-${k}" style="width:${c[k] / total * 100}%;background:var(--c)"></span>`).join('')}
    </div>
    <div class="legend">${SKEYS.map(k => `<span class="s-${k}"><span class="dot"></span>${SL[k]} <b>${c[k]}</b></span>`).join('')}</div>
    <div class="row" style="justify-content:space-between">
      <span class="note">${esc(a.site)} 전체: 기록 <span class="mono">${sitePs.length}</span>${sitePlan ? ` / 계획 <span class="mono">${sitePlan}</span>` : ''} · 정상 <span class="mono">${sitePs.filter(p => p.status === 'ok').length}</span></span>
      <button type="button" class="ghost" id="btn-area-edit">동 수정·삭제</button>
    </div>`;
  $('btn-area-edit').onclick = () => openAreaForm(a);
}

/* ---------- 입력 ---------- */
function renderEntry() {
  const a = area(); $('entry').hidden = !a; if (!a) return;
  $('ip-pre').textContent = a.prefix || ''; $('ip-pre').hidden = !a.prefix;
  $('ip-hint').textContent = a.prefix ? '끝자리만 입력 · 여러 대는 띄어쓰기로 (예: 48 49 50) · 대역이 다르면 전체 IP' : '처음 한 번은 전체 IP를 입력하세요. 다음부터는 끝자리만 쳐도 됩니다';
  $('in-ip').placeholder = a.prefix ? '53' : '172.30.54.53';
  const ls = linesOf(a.id);
  $('dl-lines').innerHTML = ls.map(l => `<option value="${esc(l.name)}">`).join('');
  const cur = $('in-line').value.trim();
  $('line-chips').innerHTML = ls.map(l => `<button type="button" class="chip" data-name="${esc(l.name)}" aria-pressed="${l.name === cur}">${esc(l.name)}</button>`).join('');
}
$('line-chips').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('in-line').value = b.dataset.name; renderEntry(); $('in-ip').focus() });
$('in-line').addEventListener('input', () => { const cur = $('in-line').value.trim(); $('line-chips').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.name === cur)) });
$('in-ip').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save() } });
$('btn-save').addEventListener('click', save);

async function ensureLine(a, name) {
  const found = linesOf(a.id).find(l => l.name === name); if (found) return found.id;
  const ref = db.collection('lines').doc(); await ref.set({ areaId: a.id, name, planned: 0, createdAt: Date.now() });
  return ref.id;
}
let saving = false;
async function save() {
  const a = area(); const msg = $('entry-msg'); if (!a || !db || saving) return;
  const name = $('in-line').value.trim(); const raw = $('in-ip').value.trim();
  if (!name) { show(msg, '라인 / 구역 이름을 입력하세요.', 'err'); $('in-line').focus(); return }
  if (!raw) { show(msg, 'IP를 입력하세요.', 'err'); $('in-ip').focus(); return }
  const ips = [], bad = [], dup = [];
  for (const p of raw.split(/[\s,]+/).filter(Boolean)) {
    const ip = p.includes('.') ? p : (a.prefix ? a.prefix + p : p);
    if (!validIp(ip)) { bad.push(p); continue }
    const ex = S.pcs.find(x => x.ip === ip);
    if (ex || ips.includes(ip)) { const ea = ex && S.areas.find(x => x.id === ex.areaId); const el = ex && S.lines.find(x => x.id === ex.lineId); dup.push(ex ? `${ip} (${ea ? ea.dong : ''} · ${el ? el.name : ''})` : ip); continue }
    ips.push(ip);
  }
  if (!ips.length) { show(msg, [bad.length ? `형식이 맞지 않음: ${bad.join(', ')}` : '', dup.length ? `이미 기록됨: ${dup.join(', ')}` : ''].filter(Boolean).join(' · '), 'err'); return }
  saving = true; $('btn-save').disabled = true;
  try {
    const lineId = await ensureLine(a, name); const memo = $('in-memo').value.trim();
    await Promise.all(ips.map(ip => db.collection('pcs').doc().set({ areaId: a.id, lineId, ip, status: S.status, memo, by: me.uid, byName: me.name, at: Date.now() })));
    const pre = ips[ips.length - 1].replace(/\d+$/, '');
    if (pre !== (a.prefix || '')) { try { await db.doc('areas/' + a.id).update({ prefix: pre }) } catch (e) {} }
    $('in-ip').value = ''; $('in-memo').value = '';
    const notes = [`${name}: ${ips.map(i => i.split('.').pop()).join(', ')} 저장`];
    if (dup.length) notes.push(`건너뜀(이미 기록): ${dup.join(', ')}`);
    if (bad.length) notes.push(`건너뜀(형식 오류): ${bad.join(', ')}`);
    show(msg, notes.join(' · '), dup.length || bad.length ? 'warn' : 'good');
    $('in-ip').focus();
  } catch (err) { writeErr(msg, err) }
  finally { saving = false; $('btn-save').disabled = false }
}

/* ---------- 라인별 목록 ---------- */
function renderLines() {
  const a = area(); const box = $('lines');
  if (!a) { box.innerHTML = S.site && S.areas.some(x => x.site === S.site) ? '<div class="empty">위에서 동을 고르면 라인별 IP가 여기에 나옵니다.</div>' : ''; return }
  const ls = linesOf(a.id); const ps = pcsOf(a.id);
  const orphan = ps.filter(p => !ls.find(l => l.id === p.lineId));
  if (!ls.length && !orphan.length) { box.innerHTML = '<div class="empty">아직 기록이 없습니다. 위 "빠른 입력"에 라인 이름과 IP를 넣고 저장하세요.</div>'; return }
  const groups = ls.map(l => ({ l, ps: ps.filter(p => p.lineId === l.id) }));
  if (orphan.length) groups.push({ l: { id: '', name: '(라인 없음)', planned: 0 }, ps: orphan });
  box.innerHTML = groups.map(({ l, ps }) => {
    ps.sort((x, y) => ipNum(x.ip) - ipNum(y.ip));
    const full = l.planned && ps.length >= l.planned;
    const open = S.openPc && ps.find(p => p.id === S.openPc);
    return `<div class="line-card">
      <div class="line-head">
        <span class="line-name">${esc(l.name)}</span>
        <span class="count ${full ? 'full' : ''}">${ps.length}${l.planned ? ' / ' + l.planned + '대' : '대'}</span>
        ${l.id ? `<button type="button" class="ghost" data-use="${esc(l.name)}">여기에 입력</button><button type="button" class="ghost" data-ledit="${l.id}" aria-expanded="${S.openLine === l.id}">수정·삭제</button>` : ''}
      </div>
      ${ps.length ? `<div class="ips">${ps.map(p => `<button type="button" class="ipchip s-${SKEYS.includes(p.status) ? p.status : 'review'}" data-pc="${p.id}" aria-expanded="${S.openPc === p.id}" title="${esc(SL[p.status] || '')}${p.memo ? ' · ' + esc(p.memo) : ''}"><span class="dot"></span>${esc(a.prefix && p.ip.startsWith(a.prefix) ? '.' + p.ip.slice(a.prefix.length) : p.ip)}${p.memo ? '<span class="memo-mark">메모</span>' : ''}</button>`).join('')}</div>` : '<div class="empty-ips">아직 IP가 없습니다.</div>'}
      ${open ? pcEditor(open, a) : ''}
      ${S.openLine === l.id ? lineEditor(l, ps.length) : ''}
    </div>`
  }).join('');
}
function pcEditor(p, a) {
  return `<div class="editor">
    <div class="row" style="justify-content:space-between"><span class="mono" style="font-size:17px;font-weight:600">${esc(p.ip)}</span><span class="note">${p.byName ? esc(p.byName) + ' · ' : ''}${fmtTime(p.at)}</span></div>
    <div class="seg" data-pcseg="${p.id}">${STATUS.map(s => `<button type="button" class="s-${s.k}" data-k="${s.k}" aria-pressed="${p.status === s.k}"><span class="dot"></span>${s.label}</button>`).join('')}</div>
    <label class="f">메모<input id="pm-${p.id}" value="${esc(p.memo || '')}"></label>
    <label class="f">라인 이동<select id="pl-${p.id}">${linesOf(a.id).map(l => `<option value="${l.id}" ${l.id === p.lineId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
    <div class="row"><button type="button" class="danger" data-pdel="${p.id}">삭제</button><span style="flex:1"></span><button type="button" data-pclose>닫기</button><button type="button" class="primary" data-psave="${p.id}">저장</button></div>
    <div class="msg" hidden data-pmsg></div>
  </div>`;
}
function lineEditor(l, n) {
  return `<div class="editor">
    <div class="row"><label class="f grow">라인 이름<input id="ln-${l.id}" value="${esc(l.name)}"></label>
    <label class="f" style="flex:0 1 110px">계획 대수<input id="lp-${l.id}" type="number" min="0" inputmode="numeric" value="${l.planned || ''}"></label></div>
    <div class="note">이름만 잘못 썼다면 위에서 고치고 저장하면 됩니다. 라인 자체가 필요 없으면 아래에서 삭제하세요.</div>
    ${n ? `<label class="f">삭제할 때 이 라인의 IP ${n}대는<select id="lm-${l.id}">${linesOf(l.areaId).filter(x => x.id !== l.id).map(x => `<option value="${x.id}">${esc(x.name)}(으)로 옮기기</option>`).join('')}<option value="__del">IP도 같이 삭제</option></select></label>` : ''}
    <div class="row"><button type="button" class="danger" data-ldel="${l.id}">라인 삭제</button><span style="flex:1"></span><button type="button" data-lclose>닫기</button><button type="button" class="primary" data-lsave="${l.id}">저장</button></div>
    <div class="msg" hidden data-lmsg></div>
  </div>`;
}
$('lines').addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return; const d = t.dataset;
  const card = t.closest('.line-card');
  if (d.pc) { S.openPc = S.openPc === d.pc ? null : d.pc; S.openLine = null; renderLines(); return }
  if (d.use !== undefined) { $('in-line').value = d.use; renderEntry(); $('entry').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('in-ip').focus({ preventScroll: true }); return }
  if (d.ledit) { S.openLine = S.openLine === d.ledit ? null : d.ledit; S.openPc = null; renderLines(); return }
  if (d.pclose !== undefined) { S.openPc = null; renderLines(); return }
  if (d.lclose !== undefined) { S.openLine = null; renderLines(); return }
  if (d.k && t.parentElement.dataset.pcseg) { t.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === t)); return }
  const pmsg = card && card.querySelector('[data-pmsg]'); const lmsg = card && card.querySelector('[data-lmsg]');
  try {
    if (d.psave) {
      const seg = card.querySelector(`[data-pcseg="${d.psave}"] button[aria-pressed="true"]`);
      const p = S.pcs.find(x => x.id === d.psave); if (!p) return;
      const body = { status: seg ? seg.dataset.k : p.status, memo: $('pm-' + p.id).value.trim(), lineId: $('pl-' + p.id).value };
      if (body.status !== p.status || body.memo !== (p.memo || '') || body.lineId !== p.lineId) await db.doc('pcs/' + p.id).update(body);
      S.openPc = null; renderLines(); return
    }
    if (d.pdel) {
      if (t.dataset.armed !== '1') { t.dataset.armed = '1'; t.textContent = '한 번 더 누르면 삭제'; return }
      await db.doc('pcs/' + d.pdel).delete(); S.openPc = null; renderLines(); return
    }
    if (d.lsave) {
      const l = S.lines.find(x => x.id === d.lsave); const name = $('ln-' + l.id).value.trim(); const planned = parseInt($('lp-' + l.id).value, 10) || 0;
      if (!name) { show(lmsg, '라인 이름을 입력하세요.', 'err'); return }
      if (linesOf(l.areaId).some(x => x.name === name && x.id !== l.id)) { show(lmsg, '같은 이름의 라인이 이미 있습니다.', 'err'); return }
      if (name !== l.name || planned !== (l.planned || 0)) await db.doc('lines/' + l.id).update({ name, planned });
      S.openLine = null; renderLines(); renderEntry(); return
    }
    if (d.ldel) {
      const l = S.lines.find(x => x.id === d.ldel); if (!l) return;
      const ps = S.pcs.filter(p => p.lineId === l.id); const sel = $('lm-' + l.id); const to = sel ? sel.value : '__del';
      if (t.dataset.armed !== '1') {
        const tgt = S.lines.find(x => x.id === to);
        t.dataset.armed = '1';
        t.textContent = !ps.length ? '한 번 더 누르면 삭제' : to === '__del' ? `IP ${ps.length}대까지 삭제 — 한 번 더 누르기` : `IP ${ps.length}대를 ${tgt ? tgt.name : ''}(으)로 옮기고 삭제 — 한 번 더 누르기`;
        if (sel) sel.onchange = () => { t.dataset.armed = ''; t.textContent = '라인 삭제' };
        return
      }
      t.disabled = true;
      const ops = ps.map(p => to === '__del' ? { op: 'delete', path: 'pcs/' + p.id } : { op: 'update', path: 'pcs/' + p.id, data: { lineId: to } });
      ops.push({ op: 'delete', path: 'lines/' + l.id });
      await db.batch(ops);
      if ($('in-line').value.trim() === l.name) $('in-line').value = '';
      S.openLine = null; renderLines(); renderEntry(); return
    }
  } catch (err) { writeErr(pmsg || lmsg, err) }
});

/* ---------- 콘솔 대조 ---------- */
$('cmp-run').addEventListener('click', () => {
  const a = area(); const out = $('cmp-out'); if (!a) return;
  const found = [...new Set(($('cmp-text').value.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || []).filter(validIp))];
  if (!found.length) { out.innerHTML = '<div class="msg err">붙여넣은 내용에서 IP를 찾지 못했습니다.</div>'; return }
  const siteAreas = S.areas.filter(x => x.site === a.site).map(x => x.id);
  const rec = S.pcs.filter(p => siteAreas.includes(p.areaId));
  const cs = new Set(found); const rs = new Set(rec.map(p => p.ip));
  const both = rec.filter(p => cs.has(p.ip)); const onlyRec = rec.filter(p => !cs.has(p.ip)); const onlyCon = found.filter(ip => !rs.has(ip)).sort((x, y) => ipNum(x) - ipNum(y));
  const toOk = both.filter(p => p.status !== 'ok');
  const where = p => { const ar = S.areas.find(x => x.id === p.areaId); const l = S.lines.find(x => x.id === p.lineId); return `${ar ? ar.dong : ''} · ${l ? l.name : ''}` };
  out.innerHTML = `
    <div class="msg good">콘솔 확인: <b class="mono">${both.length}</b>대 (붙여넣은 IP ${found.length}개 · ${esc(a.site)} 기록 ${rec.length}건)
      ${toOk.length ? `<div style="margin-top:8px"><button type="button" id="cmp-mark">이 중 ${toOk.length}대를 '정상'으로 표시</button></div>` : ''}</div>
    <div class="msg warn"><b>현장 기록에는 있는데 콘솔에 없음 ${onlyRec.length}대</b> — 미설치·미접속 확인 필요
      <div class="cmp-list" style="margin-top:6px">${onlyRec.sort((x, y) => ipNum(x.ip) - ipNum(y.ip)).map(p => `<span>${esc(p.ip)} <span class="muted">${esc(where(p))}</span></span>`).join('') || '없음'}</div></div>
    <div class="msg"><b>콘솔에만 있음 ${onlyCon.length}대</b> — 위치 미기록
      <div class="cmp-list" style="margin-top:6px">${onlyCon.map(s => `<span>${esc(s)}</span>`).join('') || '없음'}</div></div>`;
  const mk = $('cmp-mark');
  if (mk) mk.onclick = async () => {
    mk.disabled = true; mk.textContent = '표시 중…';
    try { await db.batch(toOk.map(p => ({ op: 'update', path: 'pcs/' + p.id, data: { status: 'ok' } }))); mk.textContent = `${toOk.length}대 정상으로 표시함` }
    catch (err) { mk.textContent = '실패 — 다시 대조해 주세요' }
  };
});

/* ---------- 내보내기 (아이폰: 공유 시트로 카톡·메일·파일에 저장) ---------- */
function csv(rows) {
  const head = ['지역', '동', '작업일', '라인', 'IP', '상태', '메모', '기록자', '기록시각'];
  const q = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v };
  return '﻿' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n');
}
async function exportCsv(scope) {
  const a = area(); const msg = $('ex-msg');
  const areas = scope === 'site' && a ? S.areas.filter(x => x.site === a.site) : S.areas;
  const rows = [];
  areas.slice().sort((x, y) => (x.site + x.dong).localeCompare(y.site + y.dong, 'ko')).forEach(ar => {
    linesOf(ar.id).forEach(l => {
      pcsOf(ar.id).filter(p => p.lineId === l.id).sort((x, y) => ipNum(x.ip) - ipNum(y.ip)).forEach(p => {
        const d = new Date(p.at || 0);
        rows.push([ar.site, ar.dong, ar.date || '', l.name, p.ip, SL[p.status] || '', p.memo || '', p.byName || '', p.at ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : ''])
      })
    })
  });
  if (!rows.length) { show(msg, '내보낼 기록이 없습니다.', 'warn'); return }
  const t = new Date();
  const fname = `현장IP기록_${scope === 'site' && a ? a.site : '전체'}_${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}.csv`;
  const blob = new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' });
  const file = new File([blob], fname, { type: 'text/csv' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: fname });
      show(msg, `${rows.length}건을 내보냈습니다.`, 'good'); return;
    }
  } catch (e) { if (e && e.name === 'AbortError') { show(msg, '내보내기를 취소했습니다.', ''); return } }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = fname; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  show(msg, `${rows.length}건을 ${fname}로 저장했습니다.`, 'good');
}
$('ex-site').addEventListener('click', () => exportCsv('site'));
$('ex-all').addEventListener('click', () => exportCsv('all'));

/* ---------- 화면 전체 ---------- */
function renderAll() {
  syncSel();
  renderSites(); renderAreas(); renderSummary(); renderEntry(); renderLines();
  $('cmp').hidden = !area(); $('export').hidden = !S.areas.length;
}
function view(name) { ['login-view', 'deny-view', 'app-view'].forEach(v => { $(v).hidden = v !== name }) }
renderSeg();

/* ---------- 시작 ---------- */
async function start() {
  const conn = $('conn');
  let appMod, authMod, fsMod;
  try {
    [appMod, authMod, fsMod] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
  } catch (e) { conn.textContent = '인터넷 연결 후 다시 열어 주세요'; conn.classList.add('off'); return }
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app); auth.languageCode = 'ko';
  let fdb;
  try { fdb = fsMod.initializeFirestore(app, { localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentSingleTabManager() }) }) }
  catch (e) { fdb = fsMod.getFirestore(app) }

  $('login-form').addEventListener('submit', async e => {
    e.preventDefault(); const btn = $('lg-btn'); btn.disabled = true; show($('lg-msg'), '');
    try { await authMod.signInWithEmailAndPassword(auth, $('lg-email').value.trim(), $('lg-pw').value) }
    catch (err) {
      const c = err && err.code;
      show($('lg-msg'), c === 'auth/too-many-requests' ? '시도가 너무 많습니다. 잠시 후 다시 시도하세요.' : c === 'auth/network-request-failed' ? '네트워크 연결을 확인하세요.' : '이메일 또는 비밀번호가 올바르지 않습니다.', 'err');
    } finally { btn.disabled = false }
  });
  const logout = async () => { try { await authMod.signOut(auth) } catch (e) {} };
  $('logout').addEventListener('click', logout);
  $('deny-logout').addEventListener('click', logout);

  authMod.onAuthStateChanged(auth, u => {
    unsubs.forEach(f => f()); unsubs = []; db = null;
    if (!u) { view('login-view'); conn.textContent = ''; return }
    /* 이메일 인증 여부는 따지지 않습니다. 관리자가 콘솔에서 만든 게스트 계정도 쓸 수 있고,
       누가 볼 수 있는지는 Firestore 보안 규칙(허용 이메일·UID 목록)이 정합니다. */
    me ={ uid: u.uid, name: u.displayName || (u.email || '').split('@')[0] };
    $('who').textContent = u.email || '';
    view('app-view');
    db = makeDb(fsMod, fdb);
    S.sites = []; S.areas = []; S.lines = []; S.pcs = []; renderAll();
    conn.textContent = '불러오는 중…'; conn.classList.remove('off');
    const cache = {};
    const sub = name => db.collection(name).onSnapshot(snap => {
      S[name] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cache[name] = snap.metadata;
      const metas = Object.values(cache);
      const offline = metas.some(m => m.fromCache), pending = metas.some(m => m.hasPendingWrites);
      conn.classList.toggle('off', offline);
      conn.textContent = offline ? (pending ? '오프라인 · 연결되면 자동 저장' : '오프라인 · 저장된 내용 표시 중') : (pending ? '저장 중…' : '동기화됨');
      renderAll();
    }, err => {
      if (err && err.code === 'permission-denied') {
        unsubs.forEach(f => f()); unsubs = [];
        view('deny-view'); conn.textContent = '';
        $('deny-text').textContent = `${u.email} 계정은 아직 현장 IP 기록 사용이 허용되지 않았습니다. 관리자에게 허용을 요청하세요.`;
      } else { conn.textContent = '연결이 끊겼습니다 — 앱을 다시 열어 주세요'; conn.classList.add('off') }
    });
    unsubs = ['sites', 'areas', 'lines', 'pcs'].map(sub);
  });
}
start();

/* 홈 화면 앱: 오프라인에서도 열리도록 화면 파일을 기기에 저장 */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/ipnote/sw.js', { scope: '/ipnote/' }).catch(() => {});
