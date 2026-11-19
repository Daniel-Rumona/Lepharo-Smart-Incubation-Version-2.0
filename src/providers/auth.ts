import type { AuthProvider } from "@refinedev/core";
import {
  signInWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { auth } from "@/firebase"; // ensure this file doesn't break SSR
// Sign-out is centralised so all three exits behave the same; see the module.
import { signOutApp } from "@/lib/firestoreCache";
import { checkLoginAccess } from "@/lib/loginAccess";

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const token = await result.user.getIdToken();

      if (typeof window !== "undefined") {
        sessionStorage.setItem("access_token", token);
        // Remove tokens written by older builds so they cannot be shared with
        // another signed-in tab.
        localStorage.removeItem("access_token");
      }

      return {
        success: true,
        redirectTo: "/",
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          name: "Login Failed",
          message: error.message,
        },
      };
    }
  },

  logout: async () => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("access_token");
      localStorage.removeItem("access_token");
      // Signs out, clears cached documents and replaces the document. Nothing
      // after this runs.
      await signOutApp("/login");
      return { success: true };
    }

    await signOut(auth);
    return {
      success: true,
      redirectTo: "/login",
    };
  },

  check: async () => {
    if (typeof window === "undefined") {
      return { authenticated: false, redirectTo: "/login" };
    }

    // authStateReady() resolves once Firebase has finished restoring a persisted
    // session. That read is asynchronous now that sessions live in IndexedDB, and
    // answering before it lands would report a signed-in user as signed out --
    // which the route guard turns into a bounce to the public landing page.
    //
    // This also replaces an onAuthStateChanged listener that was registered on
    // every check and never torn down.
    await auth.authStateReady();

    const user = auth.currentUser;
    if (!user) return { authenticated: false, redirectTo: "/login" };

    // A session that is not on the access list (one restored from before it, say)
    // is signed out. An unanswered check lets it through; the next check asks again.
    if ((await checkLoginAccess(user)) === "denied") {
      await signOutApp("/login?reason=access");
      return { authenticated: false, redirectTo: "/login?reason=access" };
    }
    return { authenticated: true };
  },

  getIdentity: async () => {
    const user: User | null = auth.currentUser;
    if (user) {
      return {
        id: user.uid,
        name: user.displayName || user.email || "Anonymous",
        email: user.email,
        avatar: user.photoURL ?? undefined,
      };
    }
    return null;
  },

  onError: async (error) => {
    return { error };
  },
};
