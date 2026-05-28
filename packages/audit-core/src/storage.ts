import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ArtifactStatus, AuditEvent, AuditJob, AuditProgress, CrawledPage, ExcludedUrl, PageAnalysis } from "./types.js";
import { auditRoot, dataRoot } from "./fsPaths.js";

function now(): string {
  return new Date().toISOString();
}

export class AuditStore {
  private db: Database.Database;

  constructor(databaseUrl = process.env.DATABASE_URL ?? "file:./data/audits.sqlite") {
    const filename = databaseUrl.startsWith("file:") ? databaseUrl.slice(5) : databaseUrl;
    const resolved = path.resolve(process.cwd(), filename);
    mkdirSync(path.dirname(resolved), { recursive: true });
    mkdirSync(dataRoot(), { recursive: true });
    this.db = new Database(resolved);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audits (
        auditId TEXT PRIMARY KEY,
        startUrl TEXT NOT NULL,
        domain TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        completedAt TEXT,
        cancelledAt TEXT,
        error TEXT,
        reportPath TEXT,
        settingsJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pages (
        pageId TEXT PRIMARY KEY,
        auditId TEXT NOT NULL,
        url TEXT NOT NULL,
        normalizedUrl TEXT NOT NULL,
        depth INTEGER NOT NULL,
        status TEXT NOT NULL,
        statusCode INTEGER,
        contentType TEXT,
        pageType TEXT,
        desktopScreenshotPath TEXT,
        mobileScreenshotPath TEXT,
        extractedDataPath TEXT,
        analysisPath TEXT,
        error TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        UNIQUE(auditId, normalizedUrl)
      );
      CREATE TABLE IF NOT EXISTS excluded_urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        auditId TEXT NOT NULL,
        url TEXT NOT NULL,
        reason TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        auditId TEXT NOT NULL,
        event TEXT NOT NULL,
        payloadJson TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
    `);
  }

  createAudit(job: AuditJob): void {
    this.db.prepare(`
      INSERT INTO audits (auditId, startUrl, domain, status, createdAt, updatedAt, settingsJson)
      VALUES (@auditId, @startUrl, @domain, @status, @createdAt, @updatedAt, @settingsJson)
    `).run({ ...job, settingsJson: JSON.stringify(job) });
  }

  listAudits(): AuditJob[] {
    return this.db.prepare("SELECT * FROM audits ORDER BY createdAt DESC").all().map(this.rowToAudit);
  }

  failInterruptedAudits(message = "Server restarted before completion. Please start a new audit."): number {
    const completedAt = now();
    const result = this.db
      .prepare(
        "UPDATE audits SET status = 'failed', error = ?, completedAt = ?, updatedAt = ? WHERE status IN ('queued', 'running')"
      )
      .run(message, completedAt, completedAt);
    return Number(result.changes);
  }

  getAudit(auditId: string): AuditJob | null {
    const row = this.db.prepare("SELECT * FROM audits WHERE auditId = ?").get(auditId);
    return row ? this.rowToAudit(row) : null;
  }

  updateAudit(auditId: string, patch: Partial<AuditJob>): void {
    const fields = Object.keys(patch).filter((key) => key !== "auditId");
    if (fields.length === 0) return;
    const assignments = fields.map((field) => `${field} = @${field}`).join(", ");
    this.db.prepare(`UPDATE audits SET ${assignments}, updatedAt = @updatedAt WHERE auditId = @auditId`).run({
      ...patch,
      auditId,
      updatedAt: now()
    });
  }

  upsertPage(page: CrawledPage): void {
    this.db.prepare(`
      INSERT INTO pages (
        pageId, auditId, url, normalizedUrl, depth, status, statusCode, contentType, pageType,
        desktopScreenshotPath, mobileScreenshotPath, extractedDataPath, analysisPath, error, createdAt, updatedAt
      ) VALUES (
        @pageId, @auditId, @url, @normalizedUrl, @depth, @status, @statusCode, @contentType, @pageType,
        @desktopScreenshotPath, @mobileScreenshotPath, @extractedDataPath, @analysisPath, @error, @createdAt, @updatedAt
      )
      ON CONFLICT(auditId, normalizedUrl) DO UPDATE SET
        status = excluded.status,
        statusCode = excluded.statusCode,
        contentType = excluded.contentType,
        pageType = excluded.pageType,
        desktopScreenshotPath = excluded.desktopScreenshotPath,
        mobileScreenshotPath = excluded.mobileScreenshotPath,
        extractedDataPath = excluded.extractedDataPath,
        analysisPath = excluded.analysisPath,
        error = excluded.error,
        updatedAt = excluded.updatedAt
    `).run(page);
  }

  listPages(auditId: string): CrawledPage[] {
    return this.db.prepare("SELECT * FROM pages WHERE auditId = ? ORDER BY depth ASC, createdAt ASC").all(auditId) as CrawledPage[];
  }

  addExcluded(excluded: ExcludedUrl): void {
    this.db.prepare("INSERT INTO excluded_urls (auditId, url, reason, createdAt) VALUES (?, ?, ?, ?)").run(
      excluded.auditId,
      excluded.url,
      excluded.reason,
      excluded.createdAt
    );
  }

  listExcluded(auditId: string): ExcludedUrl[] {
    return this.db.prepare("SELECT auditId, url, reason, createdAt FROM excluded_urls WHERE auditId = ? ORDER BY createdAt ASC").all(auditId) as ExcludedUrl[];
  }

  addEvent(auditId: string, event: string, payload: Record<string, unknown>): void {
    this.db.prepare("INSERT INTO events (auditId, event, payloadJson, createdAt) VALUES (?, ?, ?, ?)").run(
      auditId,
      event,
      JSON.stringify(payload),
      now()
    );
  }

  listEvents(auditId: string, limit = 25): AuditEvent[] {
    return this.db
      .prepare("SELECT id, auditId, event, payloadJson, createdAt FROM events WHERE auditId = ? ORDER BY id DESC LIMIT ?")
      .all(auditId, limit)
      .reverse()
      .map((row: any) => ({
        id: row.id,
        auditId: row.auditId,
        event: row.event,
        payload: JSON.parse(row.payloadJson),
        createdAt: row.createdAt
      }));
  }

  getProgress(auditId: string): AuditProgress {
    const audit = this.getAudit(auditId);
    const pages = this.listPages(auditId);
    const excluded = this.listExcluded(auditId);
    return {
      auditId,
      status: audit?.status ?? "failed",
      discovered: pages.length,
      crawled: pages.filter((page) => page.status === "crawled").length,
      failed: pages.filter((page) => page.status === "failed").length,
      excluded: excluded.length,
      analyzed: pages.filter((page) => page.analysisPath).length,
      totalQueued: pages.filter((page) => page.status === "queued").length,
      reportReady: Boolean(audit?.reportPath)
    };
  }

  getArtifactStatus(auditId: string): ArtifactStatus {
    const audit = this.getAudit(auditId);
    const pages = this.listPages(auditId);
    const reportPdfPath = audit?.reportPath ?? path.join(auditRoot(auditId), "report.pdf");
    const reportHtmlPath = reportPdfPath.replace(/\.pdf$/, ".html");
    let openAiAnalysisCount = 0;
    let fallbackAnalysisCount = 0;

    for (const page of pages) {
      if (!page.analysisPath || !existsSync(page.analysisPath)) continue;
      try {
        const raw = this.readJsonFile(page.analysisPath) as Pick<PageAnalysis, "source">;
        if (raw.source === "openai") openAiAnalysisCount += 1;
        if (raw.source === "fallback") fallbackAnalysisCount += 1;
      } catch {
        // Ignore corrupt analysis artifacts in status calculations.
      }
    }

    return {
      screenshotCount: pages.reduce(
        (count, page) =>
          count +
          (page.desktopScreenshotPath && existsSync(page.desktopScreenshotPath) ? 1 : 0) +
          (page.mobileScreenshotPath && existsSync(page.mobileScreenshotPath) ? 1 : 0),
        0
      ),
      extractedDataCount: pages.filter((page) => page.extractedDataPath && existsSync(page.extractedDataPath)).length,
      analysisCount: pages.filter((page) => page.analysisPath && existsSync(page.analysisPath)).length,
      openAiAnalysisCount,
      fallbackAnalysisCount,
      reportHtmlReady: existsSync(reportHtmlPath),
      reportPdfReady: Boolean(audit?.reportPath && existsSync(audit.reportPath)),
      reportHtmlPath: existsSync(reportHtmlPath) ? reportHtmlPath : null,
      reportPdfPath: audit?.reportPath ?? null
    };
  }

  private readJsonFile(filePath: string): unknown {
    return JSON.parse(readFileSync(filePath, "utf8"));
  }

  private rowToAudit(row: any): AuditJob {
    const settings = JSON.parse(row.settingsJson);
    return {
      ...settings,
      auditId: row.auditId,
      startUrl: row.startUrl,
      domain: row.domain,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
      cancelledAt: row.cancelledAt,
      error: row.error,
      reportPath: row.reportPath
    };
  }
}
