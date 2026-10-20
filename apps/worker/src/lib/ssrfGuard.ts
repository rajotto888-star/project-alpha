// FILE: apps/worker/src/lib/ssrfGuard.ts — v8.06 hardened for custom baseUrl (hf-space/colab/kaggle)
// SSRF guard: ensures only https, no private IPs, no localhost, no metadata endpoints.
// Catalog baseUrls are owner-controlled, but custom providers (hf-space, colab, kaggle, private-*) use
// ephemeral tunnels (trycloudflare.com, hf.space, workers.dev) which must still be validated.

export class SsrfGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfGuardError";
  }
}

function isIPv4(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(ipInt: number, cidrBase: string, prefix: number): boolean {
  const baseInt = ipv4ToInt(cidrBase);
  if (baseInt === null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isPrivateIPv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return false;
  // 127.0.0.0/8 loopback, 10.0.0.0/8 private, 172.16.0.0/12 private, 192.168.0.0/16 private
  // 169.254.0.0/16 link-local, 0.0.0.0/8, 100.64.0.0/10 CGNAT
  return (
    inCidr(ipInt, "127.0.0.0", 8) ||
    inCidr(ipInt, "10.0.0.0", 8) ||
    inCidr(ipInt, "172.16.0.0", 12) ||
    inCidr(ipInt, "192.168.0.0", 16) ||
    inCidr(ipInt, "169.254.0.0", 16) ||
    inCidr(ipInt, "0.0.0.0", 8) ||
    inCidr(ipInt, "100.64.0.0", 10)
  );
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase();
  // ::1 loopback, fc00::/7 unique local, fe80::/10 link-local, ::ffff:0:0/96 etc.
  if (h === "::1" || h === "::" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7
  if (h.startsWith("fe80:")) return true;
  if (h.startsWith("::ffff:")) {
    // IPv4-mapped IPv6, extract v4 part
    const v4 = h.split(":").pop() || "";
    if (isIPv4(v4) && isPrivateIPv4(v4)) return true;
  }
  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.com",
  "169.254.169.254", // AWS/GCP metadata
]);

export function assertSafeUrl(urlString: string): void {
  let u: URL;
  try {
    u = new URL(urlString);
  } catch {
    throw new SsrfGuardError("invalid URL format");
  }
  if (u.protocol !== "https:") {
    throw new SsrfGuardError("only https:// allowed for BYOE endpoints");
  }
  const host = u.hostname.toLowerCase();
  if (!host) throw new SsrfGuardError("missing hostname");

  // Block obvious private hostnames
  if (BLOCKED_HOSTNAMES.has(host) || host === "localhost" || host.endsWith(".localhost")) {
    throw new SsrfGuardError(`private host blocked: ${host}`);
  }
  if (host.endsWith(".internal") || host.endsWith(".local") || host === "internal") {
    throw new SsrfGuardError(`private TLD blocked: ${host}`);
  }

  // IP literal checks
  if (isIPv4(host)) {
    if (isPrivateIPv4(host)) {
      throw new SsrfGuardError(`private IPv4 blocked: ${host}`);
    }
  } else if (host.includes(":")) {
    // Likely IPv6 literal (URL parser strips brackets)
    if (isPrivateIPv6(host)) {
      throw new SsrfGuardError(`private IPv6 blocked: ${host}`);
    }
  }

  // Block non-standard ports (allow only 443 and implicit)
  if (u.port && u.port !== "443") {
    // Allow common alt https ports for tunnels? For security, block all explicit ports except 443.
    // Cloudflare tunnels and HF Spaces use 443 implicit, so this is safe.
    throw new SsrfGuardError(`non-443 port blocked: ${u.port}`);
  }

  // Explicit allowlist for free-compute gateway: trycloudflare.com, hf.space, workers.dev, huggingface.co
  // But we don't restrict to allowlist — we block private only, so public custom domains are allowed if https.
  // This keeps BYOE Lite (owner catalog) compatible with future user custom domains, with SSRF protection.
}

