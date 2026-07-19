export function cleanJid(jid) {
  if (!jid) return "";
  return String(jid).split(":")[0].split("@")[0];
}
