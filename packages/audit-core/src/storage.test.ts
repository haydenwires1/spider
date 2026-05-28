import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAuditJob } from "./runner.js";
import { AuditStore } from "./storage.js";

describe("AuditStore artifact status", () => {
  it("counts screenshots, extraction, analysis, and fallback source artifacts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "audit-store-"));
    const store = new AuditStore(`file:${path.join(dir, "audit.sqlite")}`);
    const job = createAuditJob({
      startUrl: "https://example.com",
      crawlDepth: 1,
      maxPages: 1,
      includeBlog: false,
      includePdfs: false,
      screenshotDesktop: true,
      screenshotMobile: true,
      auditType: "Full"
    });
    store.createAudit(job);

    const screenshot = path.join(dir, "screen.png");
    const extracted = path.join(dir, "extract.json");
    const analysis = path.join(dir, "analysis.json");
    await writeFile(screenshot, "png");
    await writeFile(extracted, "{}");
    await writeFile(analysis, JSON.stringify({ source: "fallback" }));

    store.upsertPage({
      pageId: "page_test",
      auditId: job.auditId,
      url: job.startUrl,
      normalizedUrl: job.startUrl,
      depth: 0,
      status: "crawled",
      statusCode: 200,
      contentType: "text/html",
      pageType: "Homepage",
      desktopScreenshotPath: screenshot,
      mobileScreenshotPath: null,
      extractedDataPath: extracted,
      analysisPath: analysis,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const status = store.getArtifactStatus(job.auditId);
    expect(status.screenshotCount).toBe(1);
    expect(status.extractedDataCount).toBe(1);
    expect(status.analysisCount).toBe(1);
    expect(status.fallbackAnalysisCount).toBe(1);
  });
});

describe("AuditStore restart cleanup", () => {
  it("marks queued and running audits failed without changing completed audits", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "audit-store-"));
    const store = new AuditStore(`file:${path.join(dir, "audit.sqlite")}`);
    const baseSettings = {
      startUrl: "https://example.com",
      crawlDepth: 1,
      maxPages: 1,
      includeBlog: false,
      includePdfs: false,
      screenshotDesktop: true,
      screenshotMobile: true,
      auditType: "Full" as const
    };
    const queued = createAuditJob(baseSettings);
    const running = createAuditJob({ ...baseSettings, startUrl: "https://example.org" });
    const completed = createAuditJob({ ...baseSettings, startUrl: "https://example.net" });
    store.createAudit(queued);
    store.createAudit(running);
    store.createAudit(completed);
    store.updateAudit(running.auditId, { status: "running" });
    store.updateAudit(completed.auditId, { status: "completed", completedAt: new Date().toISOString() });

    const changed = store.failInterruptedAudits("Restarted");

    expect(changed).toBe(2);
    expect(store.getAudit(queued.auditId)?.status).toBe("failed");
    expect(store.getAudit(queued.auditId)?.error).toBe("Restarted");
    expect(store.getAudit(running.auditId)?.status).toBe("failed");
    expect(store.getAudit(completed.auditId)?.status).toBe("completed");
  });
});
