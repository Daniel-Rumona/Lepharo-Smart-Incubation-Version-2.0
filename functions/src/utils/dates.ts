export const fmtDate = (d: Date) =>
    d.toLocaleString("en-ZA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  export function toDate(v: any): Date | null {
    try {
      if (v?.toDate && typeof v.toDate === "function") return v.toDate();
      if (v instanceof Date) return v;
      return null;
    } catch {
      return null;
    }
  }
