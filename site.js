import { firebaseConfig, SDK } from '/firebase-config.js?v=20261026b';

/* 예전 인증 메일의 링크(?verified=1)로 들어오면 로그인 페이지로 보냅니다 */
if (new URLSearchParams(location.search).get('verified') === '1') location.replace('/login/?verified=1');

const configured = !!(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);
const $ = (id) => document.getElementById(id);
const my = $('mypage');
let fb = null, auth = null, fs = null;

function say(el, text, ok) { el.textContent = text || ''; el.classList.toggle('ok', !!ok); }

function matchHint(a, b, el) {
  if (!b.value) { el.textContent = ''; el.className = 'hint'; return; }
  const same = a.value === b.value;
  el.textContent = same ? '비밀번호가 일치합니다.' : '비밀번호가 일치하지 않습니다.';
  el.className = 'hint ' + (same ? 'ok' : 'bad');
}
const checkNewMatch = () => matchHint($('mNew'), $('mNew2'), $('npMatch'));
$('mNew').addEventListener('input', checkNewMatch);
$('mNew2').addEventListener('input', checkNewMatch);

function errText(err) {
  switch (err && err.code) {
    case 'auth/weak-password': return '비밀번호가 너무 쉽습니다. 8자 이상으로 더 복잡하게 만들어 주세요.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password': return '비밀번호가 올바르지 않습니다.';
    case 'auth/too-many-requests': return '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    case 'auth/network-request-failed': return '네트워크 연결을 확인해 주세요.';
    case 'auth/requires-recent-login': return '보안을 위해 다시 로그인한 뒤 시도해 주세요.';
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

/* 이메일 인증을 마친 계정만 "로그인됨"으로 보여 줍니다 */
function renderUser(user) {
  const u = user && user.emailVerified ? user : null;
  $('authBar').hidden = !!u;
  $('userBar').hidden = !u;
  $('userEmail').textContent = u ? (u.displayName || u.email || '') : '';
  $('userEmail').title = u ? (u.email || '') : '';
}
if (configured) {
  loadFirebase().then((a) => a.onAuthStateChanged(auth, (user) => {
    renderUser(user);
    if (user && !user.emailVerified) a.signOut(auth).catch(() => {}); /* 인증 전 세션은 정리 */
  })).catch(() => {});
}

$('logoutBtn').addEventListener('click', async () => {
  try { const a = await loadFirebase(); await a.signOut(auth); } catch (_) {}
});

/* ── 마이페이지: 내 정보 확인·비밀번호 변경·회원 탈퇴 ── */
$('myBtn').addEventListener('click', () => {
  const u = auth && auth.currentUser;
  if (!u) return;
  $('pwForm').reset(); $('delForm').reset(); $('delForm').hidden = true; say($('delMsg'), '');
  $('myEmail').textContent = '이메일: ' + (u.email || '');
  $('myName').textContent = '이름: ' + (u.displayName || '(등록된 이름 없음)');
  say($('pwMsg'), ''); checkNewMatch();
  my.showModal();
});
$('myClose').addEventListener('click', () => my.close());
my.addEventListener('click', (e) => { if (e.target === my) my.close(); });

$('pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cur = $('mCur').value, nw = $('mNew').value;
  if (nw !== $('mNew2').value) { say($('pwMsg'), '새 비밀번호가 서로 다릅니다.'); return; }
  if (nw === cur) { say($('pwMsg'), '현재 비밀번호와 다른 비밀번호를 입력해 주세요.'); return; }
  const btn = $('pwSubmit'); btn.disabled = true;
  try {
    const a = await loadFirebase();
    const u = auth.currentUser;
    await a.reauthenticateWithCredential(u, a.EmailAuthProvider.credential(u.email, cur));
    await a.updatePassword(u, nw);
    $('pwForm').reset(); checkNewMatch();
    say($('pwMsg'), '비밀번호를 변경했습니다.', true);
  } catch (err) { say($('pwMsg'), errText(err)); }
  btn.disabled = false;
});

$('delOpen').addEventListener('click', () => { $('delForm').hidden = !$('delForm').hidden; });
$('delForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('delSubmit'); btn.disabled = true;
  try {
    const a = await loadFirebase();
    const u = auth.currentUser;
    await a.reauthenticateWithCredential(u, a.EmailAuthProvider.credential(u.email, $('dPw').value));
    try { if (fs) await fs.m.deleteDoc(fs.m.doc(fs.db, 'members', u.uid)); } catch (_) {}
    await a.deleteUser(u);
    location.href = '/login/?deleted=1';
    return;
  } catch (err) { say($('delMsg'), errText(err)); }
  btn.disabled = false;
});
