import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// pulls config from .env (Vite exposes them via import.meta.env)
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// connect app to Firebase project
const app = initializeApp(firebaseConfig);

// create a Firestore "db" object we can use everywhere
export const db = getFirestore(app);
