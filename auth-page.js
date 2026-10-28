import { firebaseConfig, SDK, VERIFY_URL, SIGNUP_URL } from '/firebase-config.js?v=20261026b';

const configured = !!(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);
const $ = (id) => document.getElementById(id);
const mode = document.body.dataset.mode; // login | signup | reset
const form = $('authForm'), msg = $('authMsg'), submitBtn = $('authSubmit'), resendBox = $('resendBox');
const nameIn = $('aName'), emailIn = $('aEmail'), pw = $('aPw'), pw2 = $('aPw2'), phoneIn = $('aPhone');
const agree = $('aAgree'), terms = $('aTerms'), allBox = $('aAll');
const submitLabel = submitBtn.textContent;
let fb = null, auth = null, fs = null, submitting = false;
const sendBtn = $('sendLinkBtn'), rest = $('restBox'), vState = $('verifyState');
const LS_KEY = 'gs_signup_email';
const WINDOW_MS = window.__SIGNUP_WINDOW_MS || 5 * 60 * 1000; /* 인증 후 가입을 마쳐야 하는 시간 */
let verifiedUser = null, linkPending = false, countdown = null, cooldown = null;

function say(el, text, ok) { el.textContent = text || ''; el.classList.toggle('ok', !!ok); }
const setMsg = (t, ok) => say(msg, t, ok);

/* 휴대전화: 입력하는 동안 010-1234-5678 모양으로 맞춰 줍니다 */
function fmtPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return d.slice(0, 3) + '-' + d.slice(3);
  if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
  return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
}
const phoneOk = (v) => v === '' || /^01[016789]-\d{3,4}-\d{4}$/.test(v);
if (phoneIn) phoneIn.addEventListener('input', () => { phoneIn.value = fmtPhone(phoneIn.value); });

/* 비밀번호 확인 칸: 입력하는 동안 일치 여부를 바로 알려 줍니다 */
const pwMatch = $('pwMatch');
function checkMatch() {
  if (!pw2 || !pw2.value) { pwMatch.textContent = ''; pwMatch.className = 'hint'; return; }
  const same = pw.value === pw2.value;
  pwMatch.textContent = same ? '비밀번호가 일치합니다.' : '비밀번호가 일치하지 않습니다.';
  pwMatch.className = 'hint ' + (same ? 'ok' : 'bad');
}
if (pw2) { pw.addEventListener('input', checkMatch); pw2.addEventListener('input', checkMatch); }

/* 전체 동의 ↔ 개별 동의 */
if (allBox) {
  allBox.addEventListener('change', () => { agree.checked = terms.checked = allBox.checked; });
  [agree, terms].forEach((c) => c.addEventListener('change', () => { allBox.checked = agree.checked && terms.checked; }));
}

function setBusy(b) {
  submitBtn.disabled = b;
  submitBtn.textContent = b ? '처리 중…' : submitLabel;
}

function errText(err) {
  switch (err && err.code) {
    case 'auth/email-already-in-use': return '이미 가입된 이메일입니다. 로그인하거나 비밀번호 찾기를 이용해 주세요. 인증을 아직 안 했다면 로그인 화면에서 인증 메일을 다시 받을 수 있습니다.';
    case 'auth/invalid-email': return '이메일 형식이 올바르지 않습니다.';
    case 'auth/weak-password': return '비밀번호가 너무 쉽습니다. 8자 이상으로 더 복잡하게 만들어 주세요.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return '이메일 또는 비밀번호가 올바르지 않습니다.';
    case 'auth/user-disabled': return '사용이 중지된 계정입니다. 문의해 주세요.';
    case 'auth/too-many-requests': return '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    case 'auth/network-request-failed': return '네트워크 연결을 확인해 주세요.';
    case 'auth/operation-not-allowed': return '이메일 로그인이 아직 활성화되지 않았습니다. 관리자에게 문의해 주세요.';
    default: return '처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.';
  }
}

async function loadFirebase() {
  if (fb) return fb;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js').catch(() => null)
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  auth = authMod.getAuth(app);
  auth.languageCode = 'ko';
  fs = fsMod ? { m: fsMod, db: fsMod.getFirestore(app) } : null;
  fb = authMod;
  return fb;
}

/* 회원 정보(이름·휴대전화)를 Firestore의 members 문서에 저장 — 대표자가 콘솔에서 확인합니다 */
async function saveMember(user, name, phone) {
  if (!fs) return false;
  try {
    await fs.m.setDoc(fs.m.doc(fs.db, 'members', user.uid), { name, phone, email: user.email, createdAt: fs.m.serverTimestamp() });
    return true;
  } catch (_) { return false; }
}

/* 가입 완료 여부: 가입하기를 마치면 members 문서가 생깁니다.
   (이메일 링크로 만든 계정도 providerData에 'password'로 표시되므로 providerData로는 구분할 수 없습니다) */
async function isRegistered(user) {
  if (!fs) return false;
  try {
    const snap = await fs.m.getDoc(fs.m.doc(fs.db, 'members', user.uid));
    return snap.exists();
  } catch (_) { return false; }
}

/* 이미 로그인(인증 완료)한 상태로 들어오면 홈으로 보냅니다 */
if (configured) {
  loadFirebase().then((a) => a.onAuthStateChanged(auth, (u) => { if (mode !== 'signup' && u && u.emailVerified && !submitting) location.replace('/'); })).catch(() => {});
}

/* ── 회원가입: ① 이메일 인증 → ② 정보 입력 → ③ 가입하기 ── */
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} }
};
function setVState(text, kind) { vState.textContent = text || ''; vState.className = 'hint' + (kind ? ' ' + kind : ''); }
const mmss = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

function linkErr(err) {
  switch (err && err.code) {
    case 'auth/invalid-action-code':
    case 'auth/expired-action-code': return '인증 링크가 만료되었거나 이미 사용되었습니다. 인증 메일을 다시 받아 주세요.';
    case 'auth/invalid-email': return '메일을 받은 이메일 주소와 다릅니다. 인증 메일을 받은 주소를 정확히 입력해 주세요.';
    case 'auth/operation-not-allowed': return '이메일 링크 인증이 아직 켜져 있지 않습니다. 관리자에게 문의해 주세요.';
    default: return errText(err);
  }
}

function resetToStepOne(message, kind) {
  if (countdown) { clearInterval(countdown); countdown = null; }
  verifiedUser = null; linkPending = false;
  rest.disabled = true; emailIn.readOnly = false;
  sendBtn.hidden = false; sendBtn.disabled = false; sendBtn.textContent = '인증 메일 보내기';
  setVState(message, kind);
}

function startCooldown() {
  let n = 30;
  sendBtn.disabled = true;
  const tick = () => {
    if (n <= 0) { clearInterval(cooldown); sendBtn.disabled = false; sendBtn.textContent = '인증 메일 다시 보내기'; return; }
    sendBtn.textContent = '다시 보내기 (' + n + '초)'; n -= 1;
  };
  tick(); cooldown = setInterval(tick, 1000);
}

async function sendLink() {
  if (!configured) { setVState('회원 기능은 현재 준비 중입니다.', 'bad'); return; }
  if (!emailIn.checkValidity() || !emailIn.value.trim()) { emailIn.reportValidity(); return; }
  const email = emailIn.value.trim();
  sendBtn.disabled = true;
  try {
    const a = await loadFirebase();
    await a.sendSignInLinkToEmail(auth, email, { url: SIGNUP_URL, handleCodeInApp: true });
    ls.set(LS_KEY, email);
    setVState('인증 메일을 보냈습니다. 메일의 링크를 누르면 이 화면으로 돌아와 인증이 완료돼요. (스팸함도 확인해 주세요)', 'ok');
    startCooldown();
  } catch (err) {
    sendBtn.disabled = false;
    setVState(linkErr(err), 'bad');
  }
}

async function completeLink(email) {
  sendBtn.disabled = true;
  try {
    const a = await loadFirebase();
    const cred = await a.signInWithEmailLink(auth, email, location.href);
    const u = cred.user;
    if (await isRegistered(u)) {
      await a.signOut(auth);
      resetToStepOne('이미 가입된 이메일입니다. 로그인하거나 비밀번호 찾기를 이용해 주세요.', 'bad');
      history.replaceState(null, '', location.pathname);
      return;
    }
    verifiedUser = u; linkPending = false;
    ls.del(LS_KEY);
    history.replaceState(null, '', location.pathname);
    emailIn.value = email; emailIn.readOnly = true;
    sendBtn.hidden = true; rest.disabled = false;
    const end = Date.now() + WINDOW_MS;
    const paint = () => {
      const left = end - Date.now();
      if (left <= 0) {
        a.signOut(auth).catch(() => {});
        resetToStepOne('가입 가능 시간이 지났습니다. 인증 메일을 다시 받아 주세요.', 'bad');
        return;
      }
      setVState('이메일 인증이 완료되었습니다 ✓ 남은 시간 ' + mmss(left) + ' 안에 정보를 입력하고 가입하기를 눌러 주세요.', 'ok');
    };
    paint(); countdown = setInterval(paint, 1000);
  } catch (err) {
    resetToStepOne(linkErr(err), 'bad');
    history.replaceState(null, '', location.pathname);
  }
}

if (mode === 'signup') {
  sendBtn.addEventListener('click', () => {
    if (linkPending) {
      if (!emailIn.checkValidity() || !emailIn.value.trim()) { emailIn.reportValidity(); return; }
      completeLink(emailIn.value.trim());
    } else sendLink();
  });
  if (configured) {
    loadFirebase().then((a) => {
      if (a.isSignInWithEmailLink(auth, location.href)) {
        const saved = ls.get(LS_KEY);
        if (saved) completeLink(saved);
        else {
          linkPending = true; sendBtn.textContent = '인증 확인';
          setVState('인증 메일을 받은 이메일을 한 번 더 입력하고 [인증 확인]을 눌러 주세요.');
        }
      }
    }).catch(() => {});
  }
}

/* 다른 화면에서 돌아왔을 때 안내 */
const q = new URLSearchParams(location.search);
if (q.get('verified') === '1') setMsg('이메일 인증이 완료되었습니다. 로그인해 주세요.', true);
if (q.get('deleted') === '1') setMsg('회원 탈퇴가 완료되었습니다. 이용해 주셔서 감사합니다.', true);
if (q.get('changed') === '1') setMsg('비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.', true);
if (q.has('verified') || q.has('deleted') || q.has('changed')) history.replaceState(null, '', location.pathname);

$('resendBtn').addEventListener('click', async () => {
  try {
    const a = await loadFirebase();
    if (!auth.currentUser) throw new Error('no-user');
    await a.sendEmailVerification(auth.currentUser, { url: VERIFY_URL });
    resendBox.hidden = true;
    setMsg('인증 메일을 다시 보냈습니다. 메일함(스팸함 포함)을 확인해 주세요.', true);
    await a.signOut(auth);
  } catch (err) {
    setMsg(err && err.code ? errText(err) : '메일을 보내지 못했습니다. 다시 로그인해 주세요.');
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!configured) { setMsg('회원 기능은 현재 준비 중입니다.'); return; }
  if (mode === 'signup' && !verifiedUser) { sendBtn.click(); return; }
  const email = emailIn.value.trim(), pass = pw ? pw.value : '';
  const name = nameIn ? nameIn.value.trim() : '', phone = phoneIn ? phoneIn.value.trim() : '';
  if (mode === 'signup') {
    if (!name) { setMsg('이름을 입력해 주세요.'); return; }
    if (pass !== pw2.value) { setMsg('비밀번호가 서로 다릅니다.'); return; }
    if (!phoneOk(phone)) { setMsg('휴대전화 번호 형식이 올바르지 않습니다. 예: 010-1234-5678'); return; }
  }
  setBusy(true);
  submitting = true;
  resendBox.hidden = true;
  let done = '', ok = true, needVerify = false;
  try {
    const a = await loadFirebase();
    if (mode === 'signup') {
      await a.updatePassword(verifiedUser, pass);
      try { await a.updateProfile(verifiedUser, { displayName: name }); } catch (_) {}
      await saveMember(verifiedUser, name, phone);
      location.href = '/';
      return;
    } else if (mode === 'reset') {
      await a.sendPasswordResetEmail(auth, email);
      done = '비밀번호 재설정 링크를 메일로 보냈습니다. 링크에서 새 비밀번호를 정한 뒤 로그인하세요. 로그인 후에는 마이페이지에서 언제든 바꿀 수 있습니다.';
    } else {
      const cred = await a.signInWithEmailAndPassword(auth, email, pass);
      if (cred.user.emailVerified) {
        location.href = '/';
        return;
      }
      done = '이메일 인증이 아직 되지 않았습니다. 받은 메일의 인증 링크를 누른 뒤 다시 로그인해 주세요.';
      ok = false; needVerify = true;
    }
  } catch (err) {
    submitting = false;
    setBusy(false);
    if (mode === 'signup' && err && err.code === 'auth/requires-recent-login') {
      try { await fb.signOut(auth); } catch (_) {}
      resetToStepOne('가입 가능 시간이 지났습니다. 인증 메일을 다시 받아 주세요.', 'bad');
      return;
    }
    setMsg(errText(err));
    return;
  }
  submitting = false;
  setBusy(false);
  setMsg(done, ok);
  resendBox.hidden = !needVerify;
});
