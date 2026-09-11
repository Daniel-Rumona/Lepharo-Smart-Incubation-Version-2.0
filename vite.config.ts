import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import tsconfigPaths from "vite-tsconfig-paths";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tsconfigPaths({ root: __dirname }),
    react(),
    VitePWA({
      // injectManifest, not generateSW: the worker also carries the Firebase
      // Cloud Messaging handlers, so it has to be hand-written (src/sw.ts).
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // Never activate a new worker behind the user's back -- they get a reload
      // prompt instead (src/components/pwa/UpdatePrompt.tsx).
      registerType: "prompt",
      injectRegister: null,
      manifest: {
        name: "Lepharo Smart Incubation Platform",
        short_name: "Smart Inc",
        description:
          "Incubation, compliance and reporting platform for Lepharo participants and coordinators.",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        // Matches the pre-render paint in index.html so there is no flash of the
        // wrong colour on launch.
        background_color: "#ffffff",
        theme_color: "#1677ff",
        icons: [
          { src: "/icons/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/icons/maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        // The shell and nothing else. dist/ is ~66 MB: assets/images (48 MB),
        // data (13 MB) and templates (6.3 MB) are runtime-cached in src/sw.ts,
        // because precaching them would blow past mobile storage quotas and make
        // the first install a very long download.
        // The three manifest icons are injected automatically, so listing them
        // here too would precache each one twice. Only the icons referenced from
        // outside the manifest need adding: the Apple touch icon (index.html) and
        // the bare mark (the sign-out screen, which must render offline).
        // The shell only: the entry and the vendor chunks it imports statically,
        // which is everything needed to boot. The ~200 route chunks are cached
        // on first visit by a runtime rule in src/sw.ts instead -- precaching
        // them would put the whole application back into the install cost, which
        // is exactly what the code splitting removed.
        globPatterns: [
          "index.html",
          "assets/entry-*.js",
          "assets/react-*.js",
          "assets/antd-*.js",
          "assets/firebase-*.js",
          "assets/*.css",
          "favicon.ico",
          "icons/apple-touch-icon-180x180.png",
          "icons/mark.png",
        ],
      },
      devOptions: {
        // Service workers in dev shadow your changes behind a cache and make
        // HMR confusing. Verify PWA behaviour against `vite build && vite preview`.
        enabled: false,
      },
    }),
  ],
  base: "/", // Ensures correct asset paths on Vercel
  build: {
    outDir: "dist", // Ensures build output goes to dist/
    rollupOptions: {
      output: {
        // Route chunks are mostly built from files called index.tsx, so they all
        // come out as index-[hash].js and are indistinguishable from the entry.
        // Naming the entry separately is what lets the service worker precache
        // the shell and leave the 200-odd route chunks to load on demand.
        entryFileNames: "assets/entry-[hash].js",
        // Only the vendors every screen needs, so they stay in stable files that
        // survive app releases in users' caches.
        //
        // Everything else -- charting, document generation, the calendar, the
        // markdown editor -- is deliberately left to Rollup, which splits it per
        // consumer off the lazy route boundaries. Grouping those by hand is
        // actively harmful: a manual group is all-or-nothing, so one eagerly
        // reachable module touching one library drags the entire group into the
        // shell. That is exactly how 3 MB of export tooling ended up loading on
        // the landing page.
        manualChunks: {
          antd: ["antd", "@ant-design/icons"],
          react: ["react", "react-dom", "react-router-dom"],
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/storage", "firebase/functions"],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:5000'
    }
  }
});
