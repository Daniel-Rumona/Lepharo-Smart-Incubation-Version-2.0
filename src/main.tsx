import { StrictMode } from "react";
import ReactDOM from "react-dom/client";

import "./index.css";
import App from "./App";
import { IdentityProvider } from "./contexts/IdentityContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ViewAsSafetyBoundary } from "./components/view-as/ViewAsSafetyBoundary";
import { startFirestoreCacheReconciliation } from "./lib/firestoreCacheBoot";
import { startMobileDrawerFooters } from "./utils/mobileDrawerFooters";

// A tab left open across a deploy still runs the old build, whose route chunks
// no longer exist on the server. Reload once to pick up the new build instead
// of showing a broken screen. The timestamp guard stops a reload loop if a
// chunk is genuinely missing from the new build too.
const CHUNK_RELOAD_KEY = "chunk-reload-at";
const reloadForNewBuild = () => {
    try {
        const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
        if (Date.now() - last < 30_000) return false;
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    } catch {
        // Storage unavailable: reload anyway.
    }
    window.location.reload();
    return true;
};
const isChunkLoadError = (reason: unknown) =>
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Expected a JavaScript-or-Wasm module script/i.test(
        String((reason as { message?: string } | null)?.message ?? reason),
    );
window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewBuild()) event.preventDefault();
});
window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason) && reloadForNewBuild()) event.preventDefault();
});
// React rethrows a failed lazy() import as an uncaught error, not a rejection.
window.addEventListener("error", (event) => {
    if (isChunkLoadError(event.error ?? event.message) && reloadForNewBuild()) event.preventDefault();
});

try {
    const root = ReactDOM.createRoot(document.getElementById("root")!);

    const render = () =>
        root.render(
            <StrictMode>
                <ThemeProvider>
                    <IdentityProvider>
                        <ViewAsSafetyBoundary>
                            <App />
                        </ViewAsSafetyBoundary>
                    </IdentityProvider>
                </ThemeProvider>
            </StrictMode>,
        );

    // Started, not awaited. The cache check needs to finish before the first
    // Firestore read, not before the first paint -- awaiting it here held the
    // whole app on a blank page while Firebase read its persisted session.
    // IdentityContext waits on it instead, immediately before that first read.
    startFirestoreCacheReconciliation();
    startMobileDrawerFooters();
    render();

} catch (error) {
    console.error('=== CRITICAL ERROR IN MAIN.TSX ===');
    console.error(error);
}
