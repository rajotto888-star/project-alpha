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
  "metadata.google.internal",
  "metadata.google.com",
  "169.254.169.254", // AWS/GCP metadata
]);

const LOCAL_ALLOWED_PROVIDERS = new Set(["private-llama", "private-smollm", "colab", "kaggle", "hf-space", "android-local"]);

export interface SsrfOptions {
  allowPrivate?: boolean;
  allowHttp?: boolean;
  providerId?: string;
}

export function assertSafeUrl(urlString: string, opts: SsrfOptions = {}): void {
  let u: URL;
  try {
    u = new URL(urlString);
  } catch {
    throw new SsrfGuardError("invalid URL format");
  }

  const providerId = opts.providerId || "";
  const isLocalProvider = LOCAL_ALLOWED_PROVIDERS.has(providerId) || opts.allowPrivate;

  // Protocol check: allow https always, allow http only for local providers with private IPs
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new SsrfGuardError("only https:// (and http:// for local private endpoints) allowed");
  }
  if (u.protocol === "http:" && !isLocalProvider && !opts.allowHttp) {
    throw new SsrfGuardError("only https:// allowed for this provider (http allowed only for private-llama/colab/kaggle/hf-space local)");
  }

  const host = u.hostname.toLowerCase();
  if (!host) throw new SsrfGuardError("missing hostname");

  // Block metadata endpoints always
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new SsrfGuardError(`metadata host blocked: ${host}`);
  }
  if (host === "metadata.google.internal" || host === "169.254.169.254") {
    throw new SsrfGuardError(`metadata host blocked: ${host}`);
  }
  if (host.endsWith(".internal") && !isLocalProvider) {
    throw new SsrfGuardError(`private TLD blocked: ${host}`);
  }

  // Localhost handling: block localhost unless it's a local provider with explicit allowPrivate
  if (host === "localhost" || host.endsWith(".localhost")) {
    if (!isLocalProvider) {
      throw new SsrfGuardError(`localhost blocked for provider ${providerId || "unknown"} - use custom endpoint for private-llama`);
    }
    // Allow localhost for local providers (Android Private LM on same device via adb)
  }

  // IP literal checks
  if (isIPv4(host)) {
    if (isPrivateIPv4(host) && !isLocalProvider) {
      throw new SsrfGuardError(`private IPv4 blocked: ${host} (allowed only for private-llama/colab/kaggle/hf-space)`);
    }
  } else if (host.includes(":")) {
    if (isPrivateIPv6(host) && !isLocalProvider) {
      throw new SsrfGuardError(`private IPv6 blocked: ${host}`);
    }
  }

  // Port check: allow 443 implicit, and for local providers allow common LLM ports 8080, 11434, 1234, 8000, 5000
  if (u.port) {
    if (isLocalProvider) {
      const allowedLocalPorts = new Set(["443", "80", "8080", "11434", "1234", "8000", "5000", "3000", "7860"]);
      if (!allowedLocalPorts.has(u.port)) {
        throw new SsrfGuardError(`port ${u.port} not allowed for local provider, allowed: ${Array.from(allowedLocalPorts).join(",")}`);
      }
    } else {
      if (u.port !== "443") {
        throw new SsrfGuardError(`non-443 port blocked: ${u.port}`);
      }
    }
  }
}

