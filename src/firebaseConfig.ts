// Shared by the app bundle (src/firebase.ts) and the service worker (src/sw.ts).
// The worker can't import src/firebase.ts itself -- that module initialises auth,
// analytics and Firestore, none of which exist in a worker scope -- so the config
// lives here on its own and both sides import it.
//
// These values are not secrets; Firebase web config is public by design and access
// is controlled by firestore.rules / storage.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyAYbAMxmhYYhT4WI2InSgLR9huNuvtmYvk",
  authDomain: "lepharo-smart-inc.firebaseapp.com",
  projectId: "lepharo-smart-inc",
  storageBucket: "lepharo-smart-inc.firebasestorage.app",
  messagingSenderId: "200270560997",
  appId: "1:200270560997:web:2660fc60a892a04f775e0c",
  measurementId: "G-578Y0Q3JEG"
} as const;

/**
 * Base URL of this project's HTTP (onRequest) Cloud Functions. Derived from the
 * config so the endpoints follow the active Firebase project: a URL on another
 * project rejects this project's ID tokens (401 invalid_id_token).
 */
export const functionsBaseUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net`;
