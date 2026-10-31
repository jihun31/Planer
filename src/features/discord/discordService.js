import { deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { generateLinkCode } from './linkCode.mjs';

// 연동 결과(links/{uid})는 봇만 씀. 앱은 내 문서만 읽을 수 있음
export const subscribeLink = (uid, next, error) =>
  onSnapshot(doc(db, 'links', uid), (snap) => next(snap.exists() ? snap.data() : null), error);

// 디스코드 서버 이름·아이콘 (연동된 계정만 읽을 수 있음)
export const subscribeServerInfo = (next, error) =>
  onSnapshot(doc(db, 'server', 'info'), (snap) => next(snap.exists() ? snap.data() : null), error);

// 연동 코드 만들기. 이미 있는 코드와 겹치면(규칙상 덮어쓰기 불가) 다른 코드로 다시 시도
export async function createLinkCode(uid, { attempts = 3 } = {}) {
  if (!uid) throw new Error('로그인이 필요합니다.');
  let lastError;
  for (let i = 0; i < attempts; i++) {
    const code = generateLinkCode();
    try {
      await setDoc(doc(db, 'linkCodes', code), { uid, createdAt: serverTimestamp() });
      return code;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export const deleteLinkCode = (code) => deleteDoc(doc(db, 'linkCodes', code));
