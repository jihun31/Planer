import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCVfR2Iy9HLivtiYfNKXWQFFxm3xKnM-m0",
  authDomain: "planer-f8cb7.firebaseapp.com",
  projectId: "planer-f8cb7",
  storageBucket: "planer-f8cb7.firebasestorage.app",
  messagingSenderId: "406316957914",
  appId: "1:406316957914:web:1fd1e7fc8272efeafde5e3",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// 오프라인 저장: 인터넷이 끊긴 동안 저장한 내용(인증 등)을 디스크에 보관했다가, 연결되면 보냄.
// 앱 창과 타이머 창이 같은 저장소를 같이 쓰도록 여러 창 모드를 사용
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
