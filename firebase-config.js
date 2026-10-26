/* Firebase 웹 설정 — 웹용 공개 설정값이라 코드에 들어가도 괜찮습니다. (비밀 키가 아닙니다)
   apiKey가 비어 있으면 회원 기능은 "준비 중" 안내만 표시합니다. */
export const firebaseConfig = {
  apiKey: "AIzaSyC5eB7sUxM7RiOwTqKf-9PmJuEWmfDZH6M",
  authDomain: "gorosoft-46eb7.firebaseapp.com",
  projectId: "gorosoft-46eb7",
  storageBucket: "gorosoft-46eb7.firebasestorage.app",
  messagingSenderId: "330574973161",
  appId: "1:330574973161:web:9c62c89a38a0bcbea38878"
};
export const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
/* 인증 메일의 링크를 누른 뒤 돌아올 주소 (Firebase 승인된 도메인이어야 합니다) */
export const VERIFY_URL = "https://gorosoft.co.kr/login/?verified=1";
/* 가입 시 이메일 인증 링크를 누르면 돌아올 주소 */
export const SIGNUP_URL = "https://gorosoft.co.kr/signup/";
