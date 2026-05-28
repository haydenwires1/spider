import { describe, expect, it } from "vitest";
import { deriveDiagnostics } from "./diagnostics.js";
import type { ArtifactStatus, AuditEvent, AuditJob, AuditProgress, CrawledPage } from "./types.js";

function audit(status: AuditJob["status"], error: string | null = null): AuditJob {
  return {
    auditId: "audit_test",
    startUrl: "https://example.com",
    domain: "example.com",
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error,
    crawlDepth: 2,
    maxPages: 25,
    includeBlog: false,
    includePdfs: false,
    screenshotDesktop: true,
    screenshotMobile: true,
    auditType: "Full"
  };
}

const progress: AuditProgress = {
  auditId: "audit_test",
  status: "running",
  discovered: 4,
  crawled: 3,
  failed: 1,
  excluded: 0,
  analyzed: 3,
  totalQueued: 0,
  reportReady: false
};

const artifacts: ArtifactStatus = {
  screenshotCount: 6,
  extractedDataCount: 3,
  analysisCount: 3,
  openAiAnalysisCount: 0,
  fallbackAnalysisCount: 3,
  reportHtmlReady: true,
  reportPdfReady: false,
  reportHtmlPath: "/tmp/report.html",
  reportPdfPath: null
};

const page: CrawledPage = {
  pageId: "page_test",
  auditId: "audit_test",
  url: "https://example.com",
  normalizedUrl: "https://example.com",
  depth: 0,
  status: "crawled",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

describe("deriveDiagnostics", () => {
  it("identifies PDF-stage failures with next actions", () => {
    const events: AuditEvent[] = [
      { id: 1, auditId: "audit_test", event: "report_started", payload: {}, createdAt: new Date().toISOString() },
      { id: 2, auditId: "audit_test", event: "report_failed", payload: {}, createdAt: new Date().toISOString() }
    ];
    const diagnostics = deriveDiagnostics(
      audit("failed", "page.setContent: Target page, context or browser has been closed"),
      { ...progress, status: "failed" },
      [page],
      events,
      artifacts
    );
    expect(diagnostics.phase).toBe("Failed");
    expect(diagnostics.failureStage).toBe("pdf");
    expect(diagnostics.message).toContain("PDF report generation");
    expect(diagnostics.nextActions.some((action) => action.includes("smaller Max pages"))).toBe(true);
  });

  it("shows completed success indicators", () => {
    const diagnostics = deriveDiagnostics(
      audit("completed"),
      { ...progress, status: "completed", reportReady: true },
      [page],
      [],
      { ...artifacts, reportPdfReady: true, reportPdfPath: "/tmp/report.pdf" }
    );
    expect(diagnostics.phase).toBe("Completed");
    expect(diagnostics.tone).toBe("success");
    expect(diagnostics.successIndicators).toContain("PDF report is ready to download.");
  });

  it("warns when fallback analysis was used", () => {
    const diagnostics = deriveDiagnostics(audit("running"), progress, [page], [], artifacts);
    expect(diagnostics.setupWarnings[0]).toContain("OpenAI API key");
  });
});
