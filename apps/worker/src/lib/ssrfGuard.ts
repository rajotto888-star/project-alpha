// FILE: apps/worker/src/lib/ssrfGuard.ts (NEW — v1.1+ true BYOE, NOT part of Lite)
// Placeholder — deferred per §5 upgrade policy. True BYOE (user-supplied baseUrl) needs SSRF guard.
// This file is NOT used in BYOE Lite (owner-managed fixed URLs only, no SSRF surface).
// When v1.1+ lands, implement:
//   - allowlist of private IP ranges blocked (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, ::1, fe80::/10)
//   - DNS rebinding guard (resolve then check IP, no redirects to private)
//   - scheme check (https only), port allowlist, etc.
// For now, this is a stub to show where the guard will live.

export class SsrfGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfGuardError";
  }
}

export function assertSafeUrl(urlString: string): void {
  // TODO v1.1+: implement real SSRF checks
  const u = new URL(urlString);
  if (u.protocol !== "https:") {
    throw new SsrfGuardError("only https:// allowed for BYOE endpoints");
  }
  // Placeholder: block obvious private hosts
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    throw new SsrfGuardError("private host blocked");
  }
  // TODO: DNS lookup + IP range check, redirect guard, etc.
}

