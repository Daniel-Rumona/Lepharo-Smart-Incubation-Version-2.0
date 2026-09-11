import { StrictMode } from "react";
import ReactDOM from "react-dom/client";

import "./index.css";
import App from "./App";
import { IdentityProvider } from "./contexts/IdentityContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ViewAsSafetyBoundary } from "./components/view-as/ViewAsSafetyBoundary";
import { startFirestoreCacheReconciliation } from "./lib/firestoreCacheBoot";

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
    render();

} catch (error) {
    console.error('=== CRITICAL ERROR IN MAIN.TSX ===');
    console.error(error);
}
