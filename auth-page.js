import { firebaseConfig, SDK, VERIFY_URL } from '/firebase-config.js';

const configured = !!(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);
const $ = (id) => document.getElementById(id);
const mode = document.body.dataset.mode; // login | signup | reset
const form = $('authForm'), msg = $('authMsg'), submitBtn = $('authSubmit'), resendBox = $('resendBox');
const nameIn = $('aName'), emailIn = $('aEmail'), pw = $('aPw'), pw2 = $('aPw2'), phoneIn = $('aPhone');
const agree = $('aAgree'), terms = $('aTerms'), allBox = $('aAll');
const submitLabel = submitBtn.textContent;
let fb = null, auth = null, fs = null, submitting = false;

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

/* 이미 로그인(인증 완료)한 상태로 들어오면 홈으로 보냅니다 */
if (configured) {
  loadFirebase().then((a) => a.onAuthStateChanged(auth, (u) => { if (u && u.emailVerified && !submitting) location.replace('/'); })).catch(() => {});
}

/* 다른 화면에서 돌아왔을 때 안내 */
const q = new URLSearchParams(location.search);
if (q.get('verified') === '1') setMsg('이메일 인증이 완료되었습니다. 로그인해 주세요.', true);
if (q.get('deleted') === '1') setMsg('회원 탈퇴가 완료되었습니다. 이용해 주셔서 감사합니다.', true);
if (q.has('verified') || q.has('deleted')) history.replaceState(null, '', location.pathname);

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
      const cred = await a.createUserWithEmailAndPassword(auth, email, pass);
      try { await a.updateProfile(cred.user, { displayName: name }); } catch (_) {}
      await saveMember(cred.user, name, phone);
      try { await a.sendEmailVerification(cred.user, { url: VERIFY_URL }); } catch (_) {}
      await a.signOut(auth);
      done = '인증 메일을 보냈습니다. 메일의 인증 링크를 누르면 가입이 완료되고, 그 뒤에 로그인할 수 있습니다. (스팸함도 확인해 주세요)';
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
    setMsg(errText(err));
    return;
  }
  submitting = false;
  setBusy(false);
  setMsg(done, ok);
  resendBox.hidden = !needVerify;
});
