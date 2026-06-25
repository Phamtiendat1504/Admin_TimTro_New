// =======================================
// FIREBASE CONFIG
// firebase deploy --only hosting
// LƯU Ý: apiKey là public key của Firebase Web SDK — được thiết kế để
// công khai trong browser. Bảo mật thực sự đến từ Firestore Security Rules.
// Để ngăn client lạ lạm dụng, hãy bật Firebase App Check:
// https://firebase.google.com/docs/app-check
// =======================================
const firebaseConfig = {
  apiKey: "AIzaSyAZO-ogX1IXCOsH8nuIFb-QOok2S7jeT5s",
  authDomain: "doantotnghiep-b39ae.firebaseapp.com",
  projectId: "doantotnghiep-b39ae",
  storageBucket: "doantotnghiep-b39ae.firebasestorage.app",
  messagingSenderId: "320322209979",
  appId: "1:320322209979:web:b07aeab412e6ff46b5419e"
};

firebase.initializeApp(firebaseConfig);
const auth    = firebase.auth();
const db      = firebase.firestore();
const storage = firebase.storage();
const functions = firebase.app().functions('asia-southeast1');
