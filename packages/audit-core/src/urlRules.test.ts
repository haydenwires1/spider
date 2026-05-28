import { describe, expect, it } from "vitest";
import { exclusionReason, isSameDomain, normalizeUrl, rootDomain } from "./urlRules.js";
import type { AuditSettings } from "./types.js";

const settings: AuditSettings = {
  startUrl: "https://www.example.com",
  crawlDepth: 3,
  maxPages: 25,
  includeBlog: false,
  includePdfs: false,
  screenshotDesktop: true,
  screenshotMobile: true,
  auditType: "Full"
};

describe("url rules", () => {
  it("normalizes duplicate URL shapes", () => {
    expect(normalizeUrl("https://example.com/page/")).toBe("https://example.com/page");
    expect(normalizeUrl("https://example.com/page?utm_source=email#section")).toBe("https://example.com/page");
    expect(normalizeUrl("/page?fbclid=123", "https://example.com")).toBe("https://example.com/page");
  });

  it("detects same-domain and subdomain behavior", () => {
    expect(rootDomain("www.example.com")).toBe("example.com");
    expect(isSameDomain("https://www.example.com/checking", "https://example.com")).toBe(true);
    expect(isSameDomain("https://blog.example.com/post", "https://example.com")).toBe(false);
    expect(isSameDomain("https://blog.example.com/post", "https://example.com", true)).toBe(true);
  });

  it("returns default exclusion reasons", () => {
    expect(exclusionReason("https://www.example.com/login", settings)).toBe("default-exclusion");
    expect(exclusionReason("https://www.example.com/file.pdf", settings)).toBe("pdf");
    expect(exclusionReason("https://www.example.com/blog/post", settings)).toBe("blog-news");
    expect(exclusionReason("https://external.test/page", settings)).toBe("external-domain");
  });
});
