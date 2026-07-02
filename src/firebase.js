const firebaseConfig = {
  apiKey: "AIzaSyC27bu69OUt7p9iqRS-XIsuLWXJoU9JUCw",
  authDomain: "tech-corretor.firebaseapp.com",
  projectId: "tech-corretor",
  storageBucket: "tech-corretor.firebasestorage.app",
  messagingSenderId: "441868741463",
  appId: "1:441868741463:web:1423fd2181b3c3c104ec12",
  measurementId: "G-D95YY4H0PD"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

if (!location.hostname.includes("localhost")) {
  try {
    const perf = firebase.performance();
  } catch (e) {}
}
