// src/utils/safeStorage.ts
export const safeLocal = {
    get(key: string): string | undefined {
      try {
        if (typeof window === 'undefined') return undefined;
        return window.localStorage.getItem(key) ?? undefined;
      } catch { return undefined; }
    },
    set(key: string, value: string) {
      try {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(key, value);
      } catch {}
    },
    remove(key: string) {
      try {
        if (typeof window === 'undefined') return;
        window.localStorage.removeItem(key);
      } catch {}
    }
  };
