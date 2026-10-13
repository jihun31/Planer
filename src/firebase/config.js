import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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
export const db = getFirestore(app);
