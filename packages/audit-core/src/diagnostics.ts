import type { ArtifactStatus, AuditDiagnostics, AuditEvent, AuditJob, AuditProgress, CrawledPage } from "./types.js";

function latestEvent(events: AuditEvent[], names: string[]): AuditEvent | undefined {
  return [...events].reverse().find((event) => names.includes(event.event));
}

function failureStage(audit: AuditJob, pages: CrawledPage[], events: AuditEvent[]): AuditDiagnostics["failureStage"] {
  const error = audit.error ?? "";
  if (latestEvent(events, ["report_failed"]) || /pdf|report|page\.setContent|page\.pdf/i.test(error)) return "pdf";
  if (pages.some((page) => page.status === "failed" && /screenshot|browser|page\.goto|timeout/i.test(page.error ?? ""))) return "screenshots";
  if (/openai|responses|json|schema|analysis/i.test(error)) return "analysis";
  if (pages.some((page) => page.status === "failed")) return "crawl";
  if (audit.status === "cancelled") return "cancelled";
  return "unknown";
}

export function deriveDiagnostics(
  audit: AuditJob,
  progress: AuditProgress,
  pages: CrawledPage[],
  events: AuditEvent[],
  artifacts: ArtifactStatus
): AuditDiagnostics {
  const crawled = progress.crawled;
  const screenshotsExpected = pages.filter((page) => page.status === "crawled").length * Number(audit.screenshotDesktop || audit.screenshotMobile);
  const setupWarnings: string[] = [];
  const successIndicators: string[] = [];
  const nextActions: string[] = [];

  if (artifacts.fallbackAnalysisCount > 0 && artifacts.openAiAnalysisCount === 0) {
    setupWarnings.push("OpenAI API key was not detected by the API process, so this run used local fallback analysis.");
    nextActions.push("Add OPENAI_API_KEY to .env and restart the API server to enable AI recommendations.");
  }
  if ((audit.screenshotDesktop || audit.screenshotMobile) && artifacts.screenshotCount === 0 && crawled > 0) {
    setupWarnings.push("Screenshots were requested, but no screenshot files are present for crawled pages.");
    nextActions.push("Run npm run playwright:install and restart the app if Chromium is missing.");
  }

  if (crawled > 0) successIndicators.push(`${crawled} page${crawled === 1 ? "" : "s"} crawled successfully.`);
  if (artifacts.screenshotCount > 0) successIndicators.push(`${artifacts.screenshotCount} screenshot file${artifacts.screenshotCount === 1 ? "" : "s"} saved.`);
  if (artifacts.analysisCount > 0) successIndicators.push(`${artifacts.analysisCount} page analysis file${artifacts.analysisCount === 1 ? "" : "s"} saved.`);
  if (artifacts.openAiAnalysisCount > 0) successIndicators.push(`${artifacts.openAiAnalysisCount} page${artifacts.openAiAnalysisCount === 1 ? "" : "s"} analyzed with OpenAI.`);
  if (artifacts.fallbackAnalysisCount > 0) successIndicators.push(`${artifacts.fallbackAnalysisCount} page${artifacts.fallbackAnalysisCount === 1 ? "" : "s"} used local fallback analysis.`);
  if (artifacts.reportPdfReady) successIndicators.push("PDF report is ready to download.");
  if (artifacts.reportHtmlReady && !artifacts.reportPdfReady) successIndicators.push("HTML report was preserved as a fallback artifact.");

  if (audit.status === "completed") {
    return {
      phase: "Completed",
      tone: "success",
      message: `Audit completed. ${successIndicators.join(" ")}`,
      successIndicators,
      setupWarnings,
      nextActions
    };
  }

  if (audit.status === "failed") {
    const stage = failureStage(audit, pages, events);
    if (stage === "pdf") {
      nextActions.push("Try a smaller Max pages value, then rerun the audit.");
      nextActions.push("Confirm Playwright Chromium is installed with npm run playwright:install.");
      nextActions.push("Use the preserved HTML report if the PDF failed after crawl and analysis finished.");
    } else if (stage === "crawl" || stage === "screenshots") {
      nextActions.push("Open the failed page rows below to inspect page-level errors.");
      nextActions.push("Check whether the site blocks automated browsers, has network timeouts, or disallows crawling in robots.txt.");
    } else if (stage === "analysis") {
      nextActions.push("Check OPENAI_API_KEY, model access, and network connectivity, then rerun the audit.");
    } else {
      nextActions.push("Review the stored error below and rerun with a smaller crawl limit if the failure is resource-related.");
    }
    return {
      phase: "Failed",
      tone: "danger",
      failureStage: stage,
      message: `Audit failed during ${stage === "pdf" ? "PDF report generation" : stage}. ${audit.error ?? "No error message was stored."}`,
      successIndicators,
      setupWarnings,
      nextActions
    };
  }

  if (audit.status === "cancelled") {
    return {
      phase: "Cancelled",
      tone: "warning",
      failureStage: "cancelled",
      message: "Audit was cancelled before it finished.",
      successIndicators,
      setupWarnings,
      nextActions: ["Start a new audit when you are ready to crawl again."]
    };
  }

  if (latestEvent(events, ["report_started"])) {
    return {
      phase: "Generating PDF",
      tone: "running",
      message: "Crawling and analysis are finished. The PDF report is being generated now.",
      successIndicators,
      setupWarnings,
      nextActions
    };
  }

  if (progress.discovered > 0 && progress.analyzed < progress.crawled) {
    return {
      phase: "Analyzing pages",
      tone: "running",
      message: `${progress.analyzed} of ${progress.crawled} crawled pages have analysis results.`,
      successIndicators,
      setupWarnings,
      nextActions
    };
  }

  if (screenshotsExpected > 0 && artifacts.screenshotCount < screenshotsExpected) {
    return {
      phase: "Capturing screenshots",
      tone: "running",
      message: `${artifacts.screenshotCount} screenshot files have been saved so far.`,
      successIndicators,
      setupWarnings,
      nextActions
    };
  }

  if (audit.status === "running") {
    return {
      phase: "Crawling",
      tone: "running",
      message: `${progress.crawled + progress.failed} of ${Math.max(progress.discovered, 1)} discovered pages have been processed.`,
      successIndicators,
      setupWarnings,
      nextActions
    };
  }

  return {
    phase: "Queued",
    tone: "idle",
    message: "Audit is queued and waiting to start.",
    successIndicators,
    setupWarnings,
    nextActions
  };
}
