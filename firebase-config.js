import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyApVZ6hSdi-HKIjVXsZPHRV6BhmnHvKMKE",
  authDomain: "appfiis-a6550.firebaseapp.com",
  projectId: "appfiis-a6550",
  storageBucket: "appfiis-a6550.firebasestorage.app",
  messagingSenderId: "28404604247",
  appId: "1:28404604247:web:bc9c16c771cbbeef8b7212"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export { signInWithPopup, signOut };
