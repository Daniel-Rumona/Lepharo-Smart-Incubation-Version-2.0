import { initializeApp } from "firebase/app";
import { browserLocalPersistence, indexedDBLocalPersistence, initializeAuth } from "firebase/auth";
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getMessaging, isSupported as isMessagingSupported, type Messaging } from "firebase/messaging";

import { firebaseConfig } from "./firebaseConfig";
import { isCacheDisabledForTab } from "./lib/firestoreCacheOwner";

// ✅ Initialize Firebase App
const app = initializeApp(firebaseConfig);

// ✅ Core Services
// Sessions survive the app being closed, so the installed PWA opens straight
// into the app instead of a login screen it cannot get past without a network.
//
// This replaced per-tab session persistence, which meant closing the app signed
// you out. The trade is that signing in as another account in one tab now
// switches every tab -- "View as" (src/contexts/IdentityContext.tsx) covers the
// case that mattered, and it stays per-tab because it lives in sessionStorage.
// Anyone genuinely needing two accounts at once wants two browser profiles.
//
// A session left untouched is not left signed in forever: src/utils/idleSession.ts
// bounds it, and src/components/auth/IdleSignOut.tsx enforces the bound.
//
// IndexedDB first, localStorage as a fallback for browsers that block it.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
});
// Firestore keeps its own IndexedDB cache so previously-loaded data reads offline
// and writes made offline queue up and sync on reconnect. Two things this does not
// give you, and callers have to allow for: a query never run while online resolves
// empty rather than erroring, and security rules are not evaluated locally, so a
// queued write can still be rejected by the server later.
//
// The cache is shared per-origin, so it is guarded by an ownership check on sign-in
// (src/lib/firestoreCache.ts). A tab that could not claim it falls back to memory.
export const db = initializeFirestore(app, {
  localCache: isCacheDisabledForTab()
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const storage = getStorage(app);
export const functions = getFunctions(app);

// ✅ Collection References
import { collection } from 'firebase/firestore';

export const branchesCollection = collection(db, 'branches');
export const usersCollection = collection(db, 'users');
export const branchAssignmentAuditCollection = collection(db, 'branchAssignmentAudit');
export const departmentsCollection = collection(db, 'departments');
export const inquiriesCollection = collection(db, 'inquiries');

// ✅ Optional: Export Analytics (only if supported)
let analytics: ReturnType<typeof getAnalytics> | null = null;

isSupported()
  .then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  })
  .catch(() => {
    analytics = null;
  });

// ✅ Optional: Cloud Messaging (push notifications). Not every browser/context
// supports it (e.g. some Safari versions, private browsing), so this resolves to
// null rather than throwing -- callers (usePushNotifications) treat null as "push
// isn't available here" and no-op.
let messagingInstance: Messaging | null | undefined;

export async function getMessagingInstance(): Promise<Messaging | null> {
  if (messagingInstance !== undefined) return messagingInstance;
  try {
    messagingInstance = (await isMessagingSupported()) ? getMessaging(app) : null;
  } catch {
    messagingInstance = null;
  }
  return messagingInstance;
}

export { app, analytics };
