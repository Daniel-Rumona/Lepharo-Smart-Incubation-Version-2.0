/// <reference lib="webworker" />

// The app's single service worker. It has to be single: a registration is keyed
// by scope, so the old public/firebase-messaging-sw.js (registered at "/") and a
// generated Workbox worker (also "/") would replace each other and the app would
// intermittently lose either push or offline. Both jobs live here instead.
//
// Built by vite-plugin-pwa in injectManifest mode -- self.__WB_MANIFEST is
// replaced at build time with the precache list produced from injectManifest
// globPatterns in vite.config.ts.

import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import {
    cleanupOutdatedCaches,
    createHandlerBoundToURL,
    precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";

import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";

import { firebaseConfig } from "./firebaseConfig";

declare let self: ServiceWorkerGlobalScope;

// ───────────────────────────────────────────────────────────
// Precache: the app shell only
// ───────────────────────────────────────────────────────────
// Deliberately narrow. The build emits ~66 MB; images, reference data and
// document templates are far too large to precache and are handled by the
// runtime routes below instead.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Take over the page that just installed us, so the first visit is already
// offline-capable instead of waiting for a second load. This does not bypass the
// update prompt: an updated worker sits in "waiting" until the user accepts, and
// only claims clients once it activates.
clientsClaim();

// The app is a SPA and vercel.json already rewrites every path to index.html.
// Mirror that here so deep links resolve offline too. /api is proxied to a
// backend and must never be answered with the shell.
registerRoute(
    new NavigationRoute(createHandlerBoundToURL("index.html"), {
        denylist: [/^\/api\//],
    }),
);

// ───────────────────────────────────────────────────────────
// Runtime caches
// ───────────────────────────────────────────────────────────

// Route chunks. Only the shell is precached; each screen's code arrives on first
// visit and is kept so that screen works offline afterwards. Filenames are
// content-hashed and therefore immutable, so cache-first needs no revalidation
// -- a new build produces new names. Capped so superseded chunks from old
// deploys age out instead of accumulating.
//
// Precached URLs never reach this: precacheAndRoute registers its route first.
registerRoute(
    ({ url, sameOrigin, request }) =>
        sameOrigin &&
        url.pathname.startsWith('/assets/') &&
        (request.destination === 'script' || url.pathname.endsWith('.js')),
    new CacheFirst({
        cacheName: 'route-chunks',
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200] }),
            new ExpirationPlugin({
                maxEntries: 160,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
            }),
        ],
    }),
);

// Province/municipality lookups and map assets. Static and rarely revised, so
// serve from cache and let entries age out rather than revalidating each time.
registerRoute(
    ({ url, sameOrigin }) =>
        sameOrigin && (url.pathname.startsWith("/data/") || url.pathname.startsWith("/maps/")),
    new CacheFirst({
        cacheName: "reference-data",
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200] }),
            new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 90 }),
        ],
    }),
);

// docxtemplater/pptx source templates. Only fetched when a user generates a
// document, so these populate on first use rather than on install.
registerRoute(
    ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/templates/"),
    new CacheFirst({
        cacheName: "document-templates",
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200] }),
            new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 }),
        ],
    }),
);

// Bundled imagery (48 MB of it). Capped hard so a user who browses a lot of
// pages doesn't quietly fill their storage quota.
registerRoute(
    ({ request, sameOrigin }) => sameOrigin && request.destination === "image",
    new CacheFirst({
        cacheName: "images",
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200] }),
            new ExpirationPlugin({
                maxEntries: 120,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
            }),
        ],
    }),
);

// Google Fonts, linked from index.html. The stylesheet changes when Google
// rotates font builds; the font files themselves are immutable.
registerRoute(
    ({ url }) => url.origin === "https://fonts.googleapis.com",
    new StaleWhileRevalidate({ cacheName: "google-fonts-stylesheets" }),
);

registerRoute(
    ({ url }) => url.origin === "https://fonts.gstatic.com",
    new CacheFirst({
        cacheName: "google-fonts-files",
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200] }),
            new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
        ],
    }),
);

// Firestore, Storage and Cloud Functions are intentionally not cached here.
// Firestore has its own IndexedDB layer, and the other two have no safe
// offline semantics -- a cached upload or callable response would be a lie.

// ───────────────────────────────────────────────────────────
// Updates
// ───────────────────────────────────────────────────────────
// A waiting worker only takes over when the user accepts the reload prompt
// (src/components/pwa/UpdatePrompt.tsx), so nobody loses in-flight form state
// to a background update.
self.addEventListener("message", event => {
    if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// ───────────────────────────────────────────────────────────
// Push notifications
// ───────────────────────────────────────────────────────────
// Foreground pushes are still handled in-app by onMessage() in
// src/hooks/usePushNotifications.ts; this only covers the backgrounded case.
const messaging = getMessaging(initializeApp(firebaseConfig));

onBackgroundMessage(messaging, payload => {
    const title = payload.notification?.title || "Smart Incubation";
    const body = payload.notification?.body || "You have a new notification.";
    const link = payload.fcmOptions?.link || payload.data?.link || "/";

    self.registration.showNotification(title, {
        body,
        icon: "/icons/pwa-192x192.png",
        badge: "/icons/pwa-192x192.png",
        // Collapses repeats of the same alert instead of stacking them.
        tag: payload.data?.tag,
        data: { link },
    });
});

// Focus an already-open tab rather than launching a second copy of the app.
self.addEventListener("notificationclick", event => {
    event.notification.close();
    const link = (event.notification.data?.link as string | undefined) || "/";
    const target = new URL(link, self.location.origin);

    event.waitUntil(
        (async () => {
            const clients = await self.clients.matchAll({
                type: "window",
                includeUncontrolled: true,
            });
            for (const client of clients) {
                if (new URL(client.url).origin !== target.origin) continue;
                await client.focus();
                if (client.url !== target.href) await client.navigate(target.href);
                return;
            }
            await self.clients.openWindow(target.href);
        })(),
    );
});
