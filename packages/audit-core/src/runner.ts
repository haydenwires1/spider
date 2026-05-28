import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import robotsParser from "robots-parser";
import type { Robot } from "robots-parser";
import type { AuditJob, AuditSettings, CrawlCallbacks, CrawlCandidate, CrawledPage } from "./types.js";
import { analyzePage, writeAnalysis } from "./analyzer.js";
import { ensureAuditDirs } from "./fsPaths.js";
import { classifyPage } from "./pageType.js";
import { generatePdfReport } from "./report.js";
import { renderAndExtractPage, withBrowser, writeExtract } from "./renderer.js";
import { AuditStore } from "./storage.js";
import { exclusionReason, isSameDomain, normalizeUrl, rootDomain, slugForUrl } from "./urlRules.js";

function now(): string {
  return new Date().toISOString();
}

export function createAuditJob(settings: AuditSettings): AuditJob {
  const normalized = normalizeUrl(settings.startUrl);
  if (!normalized) throw new Error("Starting URL must be a valid http or https URL.");
  const parsed = new URL(normalized);
  return {
    ...settings,
    startUrl: normalized,
    crawlDepth: Math.max(0, Math.min(settings.crawlDepth || 3, 10)),
    maxPages: Math.max(1, Math.min(settings.maxPages || 25, 100)),
    includeBlog: Boolean(settings.includeBlog),
    includePdfs: Boolean(settings.includePdfs),
    screenshotDesktop: settings.screenshotDesktop !== false,
    screenshotMobile: settings.screenshotMobile !== false,
    auditType: settings.auditType || "Full",
    respectRobotsTxt: settings.respectRobotsTxt ?? process.env.RESPECT_ROBOTS_TXT !== "false",
    auditId: `audit_${randomUUID()}`,
    domain: rootDomain(parsed.hostname),
    status: "queued",
    createdAt: now(),
    updatedAt: now()
  };
}

async function getRobots(settings: AuditSettings): Promise<Robot | null> {
  if (!settings.respectRobotsTxt) return null;
  try {
    const parsed = new URL(settings.startUrl);
    const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
    const response = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
    const body = response.ok ? await response.text() : "";
    return robotsParser(robotsUrl, body);
  } catch {
    return null;
  }
}

function makeQueuedPage(auditId: string, candidate: CrawlCandidate): CrawledPage {
  return {
    pageId: `page_${randomUUID()}`,
    auditId,
    url: candidate.url,
    normalizedUrl: candidate.normalizedUrl,
    depth: candidate.depth,
    status: "queued",
    statusCode: null,
    contentType: null,
    pageType: null,
    desktopScreenshotPath: null,
    mobileScreenshotPath: null,
    extractedDataPath: null,
    analysisPath: null,
    error: null,
    createdAt: now(),
    updatedAt: now()
  };
}

function emit(store: AuditStore, auditId: string, callbacks: CrawlCallbacks, event: string, payload: Record<string, unknown>): void {
  store.addEvent(auditId, event, payload);
  callbacks.onEvent?.(event, payload);
}

async function enqueueLinks(
  store: AuditStore,
  audit: AuditJob,
  links: string[],
  depth: number,
  seen: Set<string>,
  queue: CrawlCandidate[]
): Promise<void> {
  if (depth >= audit.crawlDepth) return;
  for (const link of links) {
    if (seen.size >= audit.maxPages) return;
    const normalized = normalizeUrl(link, audit.startUrl);
    if (!normalized || seen.has(normalized)) continue;
    const reason = exclusionReason(normalized, audit);
    if (reason) {
      store.addExcluded({ auditId: audit.auditId, url: normalized, reason, createdAt: now() });
      continue;
    }
    if (!isSameDomain(normalized, audit.startUrl, audit.includeSubdomains)) continue;
    seen.add(normalized);
    const candidate = { url: normalized, normalizedUrl: normalized, depth: depth + 1 };
    queue.push(candidate);
    store.upsertPage(makeQueuedPage(audit.auditId, candidate));
  }
}

export async function runAudit(auditId: string, store = new AuditStore(), callbacks: CrawlCallbacks = {}): Promise<void> {
  const audit = store.getAudit(auditId);
  if (!audit) throw new Error(`Audit ${auditId} not found.`);
  const dirs = await ensureAuditDirs(auditId);
  const queue: CrawlCandidate[] = [{ url: audit.startUrl, normalizedUrl: audit.startUrl, depth: 0 }];
  const seen = new Set<string>([audit.startUrl]);
  const robots = await getRobots(audit);

  store.updateAudit(auditId, { status: "running" });
  store.upsertPage(makeQueuedPage(auditId, queue[0]));
  emit(store, auditId, callbacks, "audit_started", { auditId });

  try {
    await withBrowser(async (browser) => {
      while (queue.length > 0 && seen.size <= audit.maxPages) {
        if (callbacks.isCancelled?.() || store.getAudit(auditId)?.status === "cancelled") {
          store.updateAudit(auditId, { status: "cancelled", cancelledAt: now(), completedAt: now() });
          emit(store, auditId, callbacks, "audit_cancelled", { auditId });
          return;
        }

        const candidate = queue.shift()!;
        if (robots && !robots.isAllowed(candidate.url, "WebsiteAuditCrawler")) {
          store.addExcluded({ auditId, url: candidate.url, reason: "robots-txt", createdAt: now() });
          emit(store, auditId, callbacks, "url_excluded", { url: candidate.url, reason: "robots-txt" });
          continue;
        }

        emit(store, auditId, callbacks, "page_started", { url: candidate.url, depth: candidate.depth });
        try {
          const result = await renderAndExtractPage(browser, candidate.url, audit, dirs.screenshots);
          const pageType = classifyPage(result.extract);
          const slug = slugForUrl(candidate.url);
          const extractedPath = path.join(dirs.extracted, `${slug}.json`);
          const analysisPath = path.join(dirs.analysis, `${slug}.json`);
          await writeExtract(extractedPath, result.extract);
          emit(store, auditId, callbacks, "screenshot_completed", {
            url: candidate.url,
            desktopScreenshotPath: result.desktopScreenshotPath,
            mobileScreenshotPath: result.mobileScreenshotPath
          });
          emit(store, auditId, callbacks, "analysis_started", { url: candidate.url });
          const analysis = await analyzePage(result.extract, audit);
          await writeAnalysis(analysisPath, analysis);
          emit(store, auditId, callbacks, "analysis_completed", { url: candidate.url, source: analysis.source });
          store.upsertPage({
            pageId: `page_${randomUUID()}`,
            auditId,
            url: candidate.url,
            normalizedUrl: candidate.normalizedUrl,
            depth: candidate.depth,
            status: "crawled",
            statusCode: result.statusCode,
            contentType: result.contentType,
            pageType,
            desktopScreenshotPath: result.desktopScreenshotPath,
            mobileScreenshotPath: result.mobileScreenshotPath,
            extractedDataPath: extractedPath,
            analysisPath,
            error: null,
            createdAt: now(),
            updatedAt: now()
          });
          emit(store, auditId, callbacks, "page_completed", {
            url: candidate.url,
            progress: store.getProgress(auditId)
          });
          await enqueueLinks(store, audit, result.links, candidate.depth, seen, queue);
        } catch (error) {
          store.upsertPage({
            pageId: `page_${randomUUID()}`,
            auditId,
            url: candidate.url,
            normalizedUrl: candidate.normalizedUrl,
            depth: candidate.depth,
            status: "failed",
            statusCode: null,
            contentType: null,
            pageType: null,
            desktopScreenshotPath: null,
            mobileScreenshotPath: null,
            extractedDataPath: null,
            analysisPath: null,
            error: error instanceof Error ? error.message : String(error),
            createdAt: now(),
            updatedAt: now()
          });
          emit(store, auditId, callbacks, "page_failed", {
            url: candidate.url,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    });

    if (store.getAudit(auditId)?.status === "cancelled") return;
    const pages = store.listPages(auditId);
    const excluded = store.listExcluded(auditId);
    const reportPath = path.join(dirs.root, "report.pdf");
    emit(store, auditId, callbacks, "report_started", { auditId, reportPath });
    try {
      await generatePdfReport(audit, pages, excluded, reportPath);
    } catch (error) {
      emit(store, auditId, callbacks, "report_failed", {
        auditId,
        reportPath,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    store.updateAudit(auditId, { status: "completed", completedAt: now(), reportPath });
    emit(store, auditId, callbacks, "report_ready", { auditId, reportPath });
  } catch (error) {
    store.updateAudit(auditId, {
      status: "failed",
      completedAt: now(),
      error: error instanceof Error ? error.message : String(error)
    });
    emit(store, auditId, callbacks, "audit_failed", { auditId, error: error instanceof Error ? error.message : String(error) });
  }
}

export async function loadJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function saveJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2));
}
