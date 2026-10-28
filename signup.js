/* 회원가입: ① 계정 만들기(이메일·비밀번호·동의) → ② 이메일 인증 → ③ 이름·휴대전화 입력 → 가입 완료
   - 인증은 Firebase "이메일 주소 인증 메일"을 사용합니다 (무료 요금제 하루 1,000통).
   - 가입 완료 여부는 Firestore members 문서로 판단합니다. (3단계까지 마쳐야 문서가 생김) */
import { firebaseConfig, SDK, SIGNUP_URL } from '/firebase-config.js?v=20261026b';

const $ = (id) => document.getElementById(id);
const configured = !!(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);
const RETURN_URL = SIGNUP_URL + '?verified=1';
let a = null, auth = null, fs = null, cooldown = null, busy = false;

function say(el, text, ok) { el.textContent = text || ''; el.classList.toggle('ok', !!ok); }

function errText(err) {
  switch (err && err.code) {
    case 'auth/email-already-in-use': return 'already';
    case 'auth/invalid-email': return '이메일 형식이 올바르지 않습니다.';
    case 'auth/weak-password': return '비밀번호가 너무 쉽습니다. 8자 이상으로 더 복잡하게 만들어 주세요.';
    case 'auth/too-many-requests': return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    case 'auth/quota-exceeded': return '오늘 보낼 수 있는 인증 메일이 모두 소진되었습니다. 내일 다시 시도하시거나 문의하기로 연락해 주세요.';
    case 'auth/network-request-failed': return '네트워크 연결을 확인해 주세요.';
    case 'auth/operation-not-allowed': return '이메일 가입이 아직 활성화되지 않았습니다. 관리자에게 문의해 주세요.';
    default: return '처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.';
  }
}

/* 화면 전환 */
function show(step) {
  $('loading').hidden = true;
  ['step1', 'step2', 'step3', 'stepDone'].forEach((id) => { $(id).hidden = id !== step; });
  const n = { step1: 1, step2: 2, step3: 3, stepDone: 4 }[step];
  [1, 2, 3].forEach((i) => { const li = $('sb' + i); li.className = i < n ? 'done' : (i === n ? 'on' : ''); });
}
function notice(text) { $('topNotice').hidden = !text; $('topNotice').textContent = text || ''; }

/* ── 1단계 ── */
const pw = $('aPw'), pw2 = $('aPw2'), hint = $('pwMatch');
function checkMatch() {
  if (!pw2.value) { hint.textContent = ''; hint.className = 'hint'; return; }
  const same = pw.value === pw2.value;
  hint.textContent = same ? '비밀번호가 일치합니다.' : '비밀번호가 일치하지 않습니다.';
  hint.className = 'hint ' + (same ? 'ok' : 'bad');
}
pw.addEventListener('input', checkMatch); pw2.addEventListener('input', checkMatch);
const allBox = $('aAll'), terms = $('aTerms'), agree = $('aAgree');
allBox.addEventListener('change', () => { terms.checked = agree.checked = allBox.checked; });
[terms, agree].forEach((c) => c.addEventListener('change', () => { allBox.checked = terms.checked && agree.checked; }));

$('step1').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const m = $('msg1');
  if (!configured) { say(m, '회원 기능은 현재 준비 중입니다.'); return; }
  const email = $('aEmail').value.trim();
  if (pw.value.length < 8) { say(m, '비밀번호는 8자 이상으로 입력해 주세요.'); return; }
  if (pw.value !== pw2.value) { say(m, '비밀번호가 서로 다릅니다.'); pw2.focus(); return; }
  busy = true; $('btn1').disabled = true; say(m, '');
  try {
    const cred = await a.createUserWithEmailAndPassword(auth, email, pw.value);
    try { await a.sendEmailVerification(cred.user, { url: RETURN_URL }); }
    catch (err) { goStep2(cred.user, errText(err)); return; }
    goStep2(cred.user, '');
    startCooldown();
  } catch (err) {
    const t = errText(err);
    if (t === 'already') {
      m.textContent = '';
      m.append('이미 가입된 이메일입니다. 가입을 끝내지 못했다면 ');
      const l = document.createElement('a'); l.href = '/login/'; l.textContent = '로그인';
      m.append(l, '하면 이어서 진행할 수 있어요. 비밀번호가 기억나지 않으면 ');
      const r = document.createElement('a'); r.href = '/reset/'; r.textContent = '비밀번호 찾기';
      m.append(r, '를 이용해 주세요.');
      m.classList.remove('ok');
    } else say(m, t);
  } finally { busy = false; $('btn1').disabled = false; }
});

/* ── 2단계 ── */
function goStep2(user, errMsg) {
  $('sentTo').textContent = user.email || '';
  say($('msg2'), errMsg || '');
  show('step2');
}
function startCooldown() {
  const b = $('btnResend'); let n = 60;
  clearInterval(cooldown); b.disabled = true;
  const tick = () => {
    if (n <= 0) { clearInterval(cooldown); b.disabled = false; b.textContent = '인증 메일 다시 보내기'; return; }
    b.textContent = '다시 보내기 (' + n + '초)'; n -= 1;
  };
  tick(); cooldown = setInterval(tick, 1000);
}
$('btnResend').addEventListener('click', async () => {
  const u = auth.currentUser; if (!u) { location.reload(); return; }
  try {
    await a.sendEmailVerification(u, { url: RETURN_URL });
    say($('msg2'), '인증 메일을 다시 보냈어요. 가장 최근에 받은 메일의 링크를 눌러 주세요.', true);
    startCooldown();
  } catch (err) { say($('msg2'), errText(err)); }
});

/* 인증했는지 확인 (버튼을 누르거나, 메일함에 다녀와 이 탭으로 돌아오면 자동 확인) */
async function checkVerified(fromButton) {
  const u = auth.currentUser; if (!u) { location.reload(); return; }
  try { await u.reload(); } catch (_) {}
  if (auth.currentUser && auth.currentUser.emailVerified) { goStep3(auth.currentUser); return; }
  if (fromButton) say($('msg2'), '아직 인증이 확인되지 않았어요. 메일의 인증 링크를 누른 뒤 다시 눌러 주세요.');
}
$('btnCheck').addEventListener('click', () => checkVerified(true));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('step2').hidden) checkVerified(false);
});
$('btnOther').addEventListener('click', async () => {
  try { await a.signOut(auth); } catch (_) {}
  $('step1').reset(); checkMatch(); say($('msg1'), ''); notice('');
  show('step1');
});

/* ── 3단계 ── */
function fmtPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return d.slice(0, 3) + '-' + d.slice(3);
  if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
  return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
}
const phoneOk = (v) => v === '' || /^01[016789]-\d{3,4}-\d{4}$/.test(v);
$('aPhone').addEventListener('input', () => { $('aPhone').value = fmtPhone($('aPhone').value); });

function goStep3(user) {
  $('vEmail').value = user.email || '';
  if (user.displayName) { $('aName').value = user.displayName; $('aName').readOnly = true; }
  notice('이메일 인증이 완료되었어요 ✓ 이름을 입력하면 가입이 끝나요.');
  show('step3');
  if (!$('aName').readOnly) $('aName').focus();
}

$('step3').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const m = $('msg3'), name = $('aName').value.trim(), phone = $('aPhone').value.trim();
  if (!name) { say(m, '이름을 입력해 주세요.'); return; }
  if (!phoneOk(phone)) { say(m, '휴대전화 번호 형식이 올바르지 않습니다. 예: 010-1234-5678'); return; }
  busy = true; $('btn3').disabled = true; say(m, '');
  try {
    const u = auth.currentUser;
    await u.reload();
    if (!u.emailVerified) { goStep2(u, '이메일 인증이 아직 확인되지 않았어요.'); return; }
    await u.getIdToken(true); /* 인증 완료 상태를 토큰에 반영 */
    if (!u.displayName) await a.updateProfile(u, { displayName: name });
    if (!fs) throw new Error('no-firestore');
    await fs.m.setDoc(fs.m.doc(fs.db, 'members', u.uid), { name: u.displayName || name, phone, email: u.email, createdAt: fs.m.serverTimestamp() });
    $('doneName').textContent = u.displayName || name;
    notice('');
    show('stepDone');
  } catch (err) {
    say(m, err && err.code ? errText(err) : '가입 정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
  } finally { busy = false; $('btn3').disabled = false; }
});

/* ── 시작: 로그인 상태에 따라 알맞은 단계 보여 주기 ── */
async function isRegistered(u) {
  if (!fs) return false;
  try { return (await fs.m.getDoc(fs.m.doc(fs.db, 'members', u.uid))).exists(); } catch (_) { return false; }
}

async function init() {
  const q = new URLSearchParams(location.search);
  const back = q.get('verified') === '1';
  if (back) history.replaceState(null, '', location.pathname);
  if (!configured) { notice('회원 기능은 현재 준비 중입니다.'); show('step1'); return; }
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js').catch(() => null)
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    auth = authMod.getAuth(app); auth.languageCode = 'ko';
    fs = fsMod ? { m: fsMod, db: fsMod.getFirestore(app) } : null;
    a = authMod;
  } catch (_) { $('loading').textContent = '네트워크 연결을 확인한 뒤 새로고침해 주세요.'; return; }

  const unsub = a.onAuthStateChanged(auth, async (u) => {
    unsub();
    if (!u) {
      if (back) notice('이메일 인증이 완료되었어요. 가입할 때 정한 이메일·비밀번호로 로그인하면 이어서 진행할 수 있어요.');
      show('step1'); return;
    }
    try { await u.reload(); } catch (_) {}
    if (!u.emailVerified) { goStep2(u, ''); return; }
    if (await isRegistered(u)) { location.replace('/'); return; }
    goStep3(u);
  });
}
init();
