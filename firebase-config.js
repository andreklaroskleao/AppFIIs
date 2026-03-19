import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

const configuracaoFirebase = {
    apiKey: 'AIzaSyApVZ6hSdi-HKIjVXsZPHRV6BhmnHvKMKE',
    authDomain: 'appfiis-a6550.firebaseapp.com',
    projectId: 'appfiis-a6550',
    storageBucket: 'appfiis-a6550.firebasestorage.app',
    messagingSenderId: '28404604247',
    appId: '1:28404604247:web:bc9c16c771cbbeef8b7212'
};

const aplicacaoFirebase = initializeApp(configuracaoFirebase);

const bancoDeDados = getFirestore(aplicacaoFirebase);
const autenticacao = getAuth(aplicacaoFirebase);
const provedorGoogle = new GoogleAuthProvider();

provedorGoogle.setCustomParameters({
    prompt: 'select_account'
});

export const db = bancoDeDados;
export const auth = autenticacao;
export const provider = provedorGoogle;

export {
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence
};
