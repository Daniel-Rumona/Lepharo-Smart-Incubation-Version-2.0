// Shared by the app bundle (src/firebase.ts) and the service worker (src/sw.ts).
// The worker can't import src/firebase.ts itself -- that module initialises auth,
// analytics and Firestore, none of which exist in a worker scope -- so the config
// lives here on its own and both sides import it.
//
// These values are not secrets; Firebase web config is public by design and access
// is controlled by firestore.rules / storage.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyCjocVnDcXmnexRgm9J59U0ntzrV2I1sU0",
  authDomain: "lph-smart-inc.firebaseapp.com",
  projectId: "lph-smart-inc",
  storageBucket: "lph-smart-inc.firebasestorage.app",
  messagingSenderId: "70924380334",
  appId: "1:70924380334:web:626b4503a38caad61d253f",
  measurementId: "G-2SF05FVPCR",
} as const;
