import type { AuditSettings } from "./types.js";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "msclkid"
]);

const DEFAULT_EXCLUDED_PATHS = [
  "/login",
  "/logout",
  "/admin",
  "/wp-admin",
  "/cart",
  "/checkout",
  "/account",
  "/search"
];

const BLOG_PATHS = ["/blog", "/news", "/articles", "/insights", "/press"];

export function rootDomain(hostname: string): string {
  const parts = hostname.replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  return parts.slice(-2).join(".");
}

export function normalizeUrl(rawUrl: string, baseUrl?: string): string | null {
  try {
    const url = new URL(rawUrl, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }
    if (url.searchParams.size === 0) url.search = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function isSameDomain(candidate: string, startUrl: string, includeSubdomains = false): boolean {
  const candidateUrl = new URL(candidate);
  const start = new URL(startUrl);
  if (includeSubdomains) {
    return rootDomain(candidateUrl.hostname) === rootDomain(start.hostname);
  }
  return candidateUrl.hostname.replace(/^www\./, "") === start.hostname.replace(/^www\./, "");
}

export function exclusionReason(url: string, settings: AuditSettings): string | null {
  const parsed = new URL(url);
  const path = parsed.pathname.toLowerCase();
  const query = parsed.search.toLowerCase();
  if (!isSameDomain(url, settings.startUrl, settings.includeSubdomains)) return "external-domain";
  if (!settings.includePdfs && path.endsWith(".pdf")) return "pdf";
  if (!settings.includeBlog && BLOG_PATHS.some((blogPath) => path === blogPath || path.startsWith(`${blogPath}/`))) {
    return "blog-news";
  }
  if (DEFAULT_EXCLUDED_PATHS.some((excluded) => path === excluded || path.startsWith(`${excluded}/`))) {
    return "default-exclusion";
  }
  if (query.includes("query=") || query.includes("s=")) return "search-query";
  return null;
}

export function slugForUrl(url: string): string {
  const parsed = new URL(url);
  const cleanPath = parsed.pathname.replace(/^\/|\/$/g, "");
  const slug = cleanPath || "home";
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "page";
}
