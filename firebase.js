import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBiT9FRI6hCDSIO9IVpmyWjtcVHqSP6rA4",
  authDomain: "bw-imports.firebaseapp.com",
  projectId: "bw-imports",
  storageBucket: "bw-imports.firebasestorage.app",
  messagingSenderId: "176352978247",
  appId: "1:176352978247:web:677d84c9d585e2910cd862",
  measurementId: "G-6RFV42GW63"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);