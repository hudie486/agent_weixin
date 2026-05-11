export type SlashCmd = { name: string; rest: string };

export function parseSlash(text: string): SlashCmd | null {
  let t = text.trim();
  if (t.startsWith("\uFF0F")) t = "/" + t.slice(1);
  if (!t.startsWith("/")) return null;
  const m = /^\/([^\s]+)\s*([\s\S]*)$/.exec(t);
  if (!m) return null;
  return { name: (m[1] ?? "").trim().toLowerCase(), rest: (m[2] ?? "").trim() };
}
