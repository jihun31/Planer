import { signInWithPopup, signInWithCredential, GoogleAuthProvider, signOut } from "firebase/auth";
import { auth, googleProvider } from "../../firebase/config";

export async function loginWithGoogle() {
  if (!window.electronAPI?.loginWithGoogle) {
    return signInWithPopup(auth, googleProvider);
  }
  const response = await window.electronAPI.loginWithGoogle();
  if (!response.ok) {
    const error = new Error(response.code);
    error.code = response.code;
    throw error;
  }
  // Firebase validates Google's credential and resolves the existing Google UID.
  return signInWithCredential(auth, GoogleAuthProvider.credential(null, response.accessToken));
}

export function cancelLogin() {
  window.electronAPI?.cancelGoogleLogin?.();
}

export async function logout() {
  cancelLogin();
  window.electronAPI?.closeTimerPopup?.();
  await signOut(auth);
}

export function loginErrorMessage(error) {
  const messages = {
    'desktop/config-missing': '앱의 Google 로그인 설정이 필요합니다. 배포 안내의 로그인 설정을 완료해 주세요.',
    'desktop/cancelled': '로그인을 취소했습니다.',
    'desktop/timeout': '로그인 시간이 초과되었습니다. 다시 시도해 주세요.',
    'desktop/busy': '이미 로그인을 진행 중입니다. 열린 브라우저를 확인해 주세요.',
    'desktop/browser-failed': '브라우저를 열지 못했습니다. 기본 브라우저 설정을 확인해 주세요.',
    'desktop/token-exchange-failed': 'Google 인증을 완료하지 못했습니다. 인터넷 연결과 앱 로그인 설정을 확인해 주세요.',
    'auth/popup-closed-by-user': '로그인 창이 닫혔습니다. 다시 시도해 주세요.',
    'auth/network-request-failed': '인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
    'auth/invalid-credential': '로그인 인증을 확인하지 못했습니다. Google 로그인 설정을 확인해 주세요.',
    'auth/account-exists-with-different-credential': '이미 다른 로그인 방식으로 등록된 계정입니다. 기존 로그인 방식을 확인해 주세요.',
  };
  return messages[error?.code] || '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}
