// Country dial codes used by the contact form's country-code dropdown.
export const COUNTRIES = [
  { code: "+91", label: "IN +91" },
  { code: "+1", label: "US +1" },
  { code: "+44", label: "UK +44" },
  { code: "+61", label: "AU +61" },
  { code: "+971", label: "AE +971" },
  { code: "+65", label: "SG +65" },
  { code: "+49", label: "DE +49" },
  { code: "+33", label: "FR +33" },
  { code: "+81", label: "JP +81" },
  { code: "+86", label: "CN +86" },
];

export const phoneDigits = (s: string) => (s || "").replace(/[^0-9]/g, "");

/** Valid if the local number has 7–15 digits (rejects 1–2 digit junk). */
export const isValidPhoneNumber = (num: string) => {
  const d = phoneDigits(num);
  return d.length >= 7 && d.length <= 15;
};

/**
 * Split a stored phone like "+919876543210" into { cc, number }.
 * Matches the longest known dial code; otherwise treats it all as the number.
 */
export function splitPhone(stored?: string | null, fallbackCc = "+91"): { cc: string; number: string } {
  if (!stored) return { cc: fallbackCc, number: "" };
  const s = String(stored).trim();
  if (s.startsWith("+")) {
    const match = [...COUNTRIES]
      .sort((a, b) => b.code.length - a.code.length)
      .find((c) => s.startsWith(c.code));
    if (match) return { cc: match.code, number: phoneDigits(s.slice(match.code.length)) };
  }
  return { cc: fallbackCc, number: phoneDigits(s) };
}
