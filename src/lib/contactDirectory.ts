import type { Inquiry } from "@/types/inquiry";
import { resolveInquiryAudience } from "@/utils/inquirySource";
import { inquiryContactType } from "@/lib/inquiryContactTypes";

export const CONTACT_CATEGORIES = [
  "Stakeholder",
  "Funder",
  "Incubatee",
  "Potential Incubatee",
  "Visitor",
] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];
export type ContactInput = {
  name: string;
  email: string;
  phone: string;
  company: string;
  category: ContactCategory;
  linkedInquiryIds: string[];
};
export type SavedContact = ContactInput & { id: string; branchId: string };
export type DirectoryContact = {
  id: string;
  savedId?: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  category: ContactCategory | "Unclassified";
  latest?: Inquiry;
  inquiries: Inquiry[];
};
export const contactEmail = (value: string) => value.trim().toLowerCase();
export const contactPhone = (value: string) => value.replace(/[^\d+]/g, "");

export function buildContactDirectory(
  inquiries: Inquiry[],
  saved: SavedContact[]
): DirectoryContact[] {
  const contacts: DirectoryContact[] = saved.map((contact) => ({
    ...contact,
    savedId: contact.id,
    inquiries: [],
  }));
  const sorted = [...inquiries].sort(
    (a, b) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );
  for (const inquiry of sorted) {
    const info = inquiry.contactInfo;
    const email = info?.email?.trim() || "";
    const phone = info?.phone?.trim() || "";
    if (!email && !phone) continue;
    const linked = saved.find((contact) =>
      contact.linkedInquiryIds.includes(inquiry.id)
    );
    let contact = linked
      ? contacts.find((contact) => contact.savedId === linked.id)
      : contacts.find((contact) =>
          email
            ? contactEmail(contact.email) === contactEmail(email)
            : !contact.email &&
              contactPhone(contact.phone) === contactPhone(phone)
        );
    if (!contact) {
      contact = {
        id: `inquiry-${inquiry.id}`,
        name:
          `${info.firstName || ""} ${info.lastName || ""}`.trim() ||
          "Unnamed contact",
        email,
        phone,
        company: info.company || "",
        // The contact type reception recorded on the inquiry, or for older ones,
        // what the inquiry implies (lib/inquiryContactTypes).
        category:
          inquiryContactType(
            inquiry as any,
            resolveInquiryAudience(inquiry) === "Incubatee"
          ) || "Unclassified",
        inquiries: [],
      };
      contacts.push(contact);
    }
    contact.inquiries.push(inquiry);
    if (!contact.latest) contact.latest = inquiry;
  }
  return contacts.sort(
    (a, b) =>
      (b.latest ? new Date(b.latest.submittedAt).getTime() : 0) -
        (a.latest ? new Date(a.latest.submittedAt).getTime() : 0) ||
      a.name.localeCompare(b.name)
  );
}
