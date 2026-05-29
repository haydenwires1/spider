import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { renderAndExtractPage } from "./renderer.js";
import type { AuditSettings } from "./types.js";

function settings(): AuditSettings {
  return {
    startUrl: "https://example.com",
    crawlDepth: 1,
    maxPages: 1,
    includeBlog: false,
    includePdfs: false,
    screenshotDesktop: true,
    screenshotMobile: false,
    auditType: "Full"
  };
}

describe("renderAndExtractPage", () => {
  it("keeps extracted page data when desktop screenshot capture fails", async () => {
    const calls = { closed: false };
    const page = {
      goto: async () => ({
        status: () => 200,
        headers: () => ({ "content-type": "text/html" })
      }),
      waitForLoadState: async () => undefined,
      evaluate: async (script: string) => {
        if (script.includes("document.title")) {
          return {
            url: "https://example.com",
            title: "Example",
            metaDescription: "",
            canonicalUrl: "https://example.com",
            statusCode: 200,
            contentType: "text/html",
            h1: "Example",
            headings: { h2: [], h3: [] },
            visibleText: "Example",
            wordCount: 1,
            ctas: [],
            internalLinks: [],
            externalLinks: [],
            forms: [],
            images: [],
            missingAltCount: 0,
            hasH1: true,
            h1Count: 1,
            hasMetaDescription: false,
            links: ["https://example.com/about"]
          };
        }
        return undefined;
      },
      screenshot: async () => {
        throw new Error("page.screenshot: Timeout 30000ms exceeded");
      },
      close: async () => {
        calls.closed = true;
      }
    };
    const browser = {
      newPage: async () => page
    } as unknown as Browser;
    const screenshotsDir = path.join(tmpdir(), "audit-renderer-test");
    mkdirSync(screenshotsDir, { recursive: true });

    const result = await renderAndExtractPage(browser, "https://example.com", settings(), screenshotsDir);

    expect(result.extract.title).toBe("Example");
    expect(result.links).toEqual(["https://example.com/about"]);
    expect(result.desktopScreenshotPath).toBeUndefined();
    expect(result.extract.desktopScreenshotPath).toBeUndefined();
    expect(calls.closed).toBe(true);
  });
});
