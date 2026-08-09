import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@/lib/errors";
import type { HttpMethod, HttpRequestConfig, JsonObject } from "@/lib/types";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
  "metadata",
]);

function ipv4Private(parts: number[]): boolean {
  if (parts.some((p) => p < 0 || p > 255)) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT
  return false;
}

function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;

  // IPv4-mapped IPv6 ::ffff:a.b.c.d
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(normalized);
  if (mapped) {
    const parts = mapped[1].split(".").map(Number);
    return ipv4Private(parts);
  }

  if (isIP(normalized) === 4) {
    return ipv4Private(normalized.split(".").map(Number));
  }

  if (isIP(normalized) === 6) {
    // Unique local, link-local, loopback
    if (
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80")
    ) {
      return true;
    }
  }

  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    return true;
  }
  // Decimal / hex IP tricks → still parse via URL hostname mostly dotted; block obvious integers
  if (/^\d+$/.test(host)) return true;
  if (isIP(host) && isPrivateIp(host)) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    return ipv4Private(ipv4.slice(1).map(Number));
  }
  return false;
}

export function validateHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Invalid HTTP URL", 400);
  }

  const protocol = url.protocol.toLowerCase();
  if (
    protocol === "file:" ||
    protocol === "javascript:" ||
    protocol === "data:" ||
    protocol === "ftp:"
  ) {
    throw new AppError("VALIDATION_ERROR", "Blocked URL protocol", 400);
  }

  if (protocol !== "http:" && protocol !== "https:") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Only http/https URLs are allowed",
      400
    );
  }

  if (isBlockedHostname(url.hostname)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Requests to localhost/private addresses are blocked",
      400
    );
  }

  return url;
}

async function assertPublicResolvedHost(hostname: string): Promise<void> {
  if (isBlockedHostname(hostname)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Requests to localhost/private addresses are blocked",
      400
    );
  }
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    for (const record of records) {
      if (isPrivateIp(record.address)) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Requests to localhost/private addresses are blocked",
          400
        );
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    // DNS failure — let fetch fail later as EXTERNAL_ERROR
  }
}

export async function executeHttpRequest(
  config: HttpRequestConfig
): Promise<JsonObject> {
  if (!config.url) {
    throw new AppError("VALIDATION_ERROR", "HTTP step requires a URL", 400);
  }

  const method = (config.method || "GET").toUpperCase() as HttpMethod;
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Unsupported HTTP method: ${method}`,
      400
    );
  }

  const url = validateHttpUrl(config.url);
  await assertPublicResolvedHost(url.hostname);

  if (config.query) {
    for (const [key, value] of Object.entries(config.query)) {
      url.searchParams.set(key, value);
    }
  }

  const timeoutMs = Math.min(
    Math.max(config.timeout_ms ?? 10_000, 1_000),
    30_000
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    ...(config.headers || {}),
  };

  let body: string | undefined;
  if (method !== "GET" && method !== "DELETE" && config.body !== undefined) {
    if (typeof config.body === "string") {
      body = config.body;
    } else {
      body = JSON.stringify(config.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  try {
    // Do not follow redirects — prevents open-redirect SSRF to metadata/internal hosts.
    const response = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      throw new AppError(
        "EXTERNAL_ERROR",
        `HTTP redirects are not followed (status ${response.status})`,
        502
      );
    }

    const contentType = response.headers.get("content-type") || "";
    const rawText = await response.text();
    let parsedBody: unknown = rawText;
    if (contentType.includes("application/json")) {
      try {
        parsedBody = JSON.parse(rawText);
      } catch {
        parsedBody = rawText;
      }
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: response.status,
      ok: response.ok,
      headers: responseHeaders,
      body: parsedBody as JsonObject["body"],
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError("EXTERNAL_ERROR", "HTTP request timed out", 504);
    }
    if (error instanceof AppError) throw error;
    throw new AppError("EXTERNAL_ERROR", "HTTP request failed", 502);
  } finally {
    clearTimeout(timer);
  }
}
