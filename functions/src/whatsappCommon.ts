// Small helpers shared by the Lepharo WhatsApp gateway and its staff module.

export const normalizePhone = (value: unknown) => String(value || "").replace(/[^0-9]/g, "");
export const clean = (value: unknown) => String(value || "").trim();

export const candidatePhoneValues = (digits: string) => {
  const values = new Set<string>();
  if (!digits) return [];
  values.add(digits);
  values.add(`+${digits}`);

  if (digits.startsWith("27") && digits.length >= 11) {
    values.add(`0${digits.slice(2)}`);
  }
  if (digits.startsWith("263") && digits.length >= 12) {
    values.add(`0${digits.slice(3)}`);
  }

  return Array.from(values);
};

export const timestampToIso = (value: any): string | null => {
  try {
    if (value?.toDate && typeof value.toDate === "function") return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return value || null;
    return null;
  } catch {
    return null;
  }
};
