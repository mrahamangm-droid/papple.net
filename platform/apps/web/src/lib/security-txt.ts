const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** RFC 9116 file. An unconfirmed or malformed contact is never published as a Contact line. */
export function buildSecurityTxt(contact: string | null, now: Date = new Date()): string {
  const expires = new Date(now.getTime() + 180 * 86400_000).toISOString();
  const lines: string[] = [];
  if (contact && EMAIL.test(contact)) {
    lines.push(`Contact: mailto:${contact}`);
  } else {
    lines.push("# The security contact is not yet confirmed. Please do not send reports to unverified addresses.");
  }
  lines.push(`Expires: ${expires}`, "Preferred-Languages: en");
  return `${lines.join("\n")}\n`;
}
