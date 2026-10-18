const BLOCK_PATTERNS: RegExp[] = [
  /\b(how\s+to\s+)?(make|build|construct)\s+.*\b(bomb|explosive|pipe[\s-]?bomb)\b/i,
  /\bmeth(amphetamine)?\s+synthesis\b/i,
  /\bchild\s+sexual\s+abuse\b/i,
  /\bcsam\b/i,
];

export function isPolicyBlocked(messages: Array<{ role: string; content: string }>): boolean {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return false;
  return BLOCK_PATTERNS.some((re) => re.test(lastUser.content));
}
