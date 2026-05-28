import "dotenv/config";
import cors from "cors";
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  AuditStore,
  createAuditJob,
  dataRoot,
  deriveDiagnostics,
  runAudit,
  toPublicPath,
  type AuditSettings
} from "@audit-crawler/core";

const app = express();
const port = Number(process.env.PORT || 3001);
const store = new AuditStore();
const cancelled = new Set<string>();
const clients = new Map<string, Set<express.Response>>();
const webDistPath = path.resolve(process.cwd(), "apps/web/dist");
const webIndexPath = path.join(webDistPath, "index.html");

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const auditRequestSchema = z.object({
  startUrl: z.string().url(),
  crawlDepth: z.coerce.number().int().min(0).max(10).default(3),
  maxPages: z.coerce.number().int().min(1).max(100).default(25),
  includeBlog: z.boolean().default(false),
  includePdfs: z.boolean().default(false),
  screenshotDesktop: z.boolean().default(true),
  screenshotMobile: z.boolean().default(true),
  auditType: z.enum(["Marketing", "UX", "SEO", "Conversion", "Accessibility", "Full"]).default("Full"),
  businessGoal: z.string().optional(),
  includeSubdomains: z.boolean().default(false),
  respectRobotsTxt: z.boolean().optional()
});

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function requirePrivateAccess(request: express.Request, response: express.Response, next: express.NextFunction): void {
  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;
  if (!username && !password) {
    next();
    return;
  }
  if (!username || !password) {
    response.status(500).json({ error: "APP_USERNAME and APP_PASSWORD must both be set to enable private access." });
    return;
  }

  const header = request.get("authorization");
  const [scheme, encoded] = header?.split(" ") ?? [];
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    const actualUsername = separator >= 0 ? decoded.slice(0, separator) : "";
    const actualPassword = separator >= 0 ? decoded.slice(separator + 1) : "";
    if (safeEqual(actualUsername, username) && safeEqual(actualPassword, password)) {
      next();
      return;
    }
  }

  response.setHeader("WWW-Authenticate", 'Basic realm="Website Audit Crawler", charset="UTF-8"');
  response.status(401).send("Authentication required");
}

function sendEvent(auditId: string, event: string, payload: Record<string, unknown>): void {
  const targets = clients.get(auditId);
  if (!targets) return;
  const body = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const response of targets) response.write(body);
}

function serializeAudit(auditId: string) {
  const audit = store.getAudit(auditId);
  if (!audit) return null;
  const pages = store.listPages(auditId);
  const excluded = store.listExcluded(auditId);
  const progress = store.getProgress(auditId);
  const recentEvents = store.listEvents(auditId, 25);
  const artifactStatus = store.getArtifactStatus(auditId);
  const diagnostics = deriveDiagnostics(audit, progress, pages, recentEvents, artifactStatus);
  return {
    audit: {
      ...audit,
      reportUrl: audit.reportPath ? `/api/audits/${auditId}/report.pdf` : null,
      reportHtmlUrl: artifactStatus.reportHtmlReady ? `/api/audits/${auditId}/report.html` : null
    },
    progress,
    diagnostics,
    artifactStatus: {
      ...artifactStatus,
      reportHtmlUrl: artifactStatus.reportHtmlPath ? toPublicPath(artifactStatus.reportHtmlPath) : null,
      reportPdfUrl: artifactStatus.reportPdfPath ? `/api/audits/${auditId}/report.pdf` : null
    },
    recentEvents,
    pages: pages.map((page) => ({
      ...page,
      desktopScreenshotUrl: page.desktopScreenshotPath ? toPublicPath(page.desktopScreenshotPath) : null,
      mobileScreenshotUrl: page.mobileScreenshotPath ? toPublicPath(page.mobileScreenshotPath) : null
    })),
    excluded
  };
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.use(requirePrivateAccess);
app.use("/files", express.static(dataRoot()));

app.post("/api/audits", (request, response) => {
  const parsed = auditRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const settings = parsed.data satisfies AuditSettings;
  const job = createAuditJob(settings);
  store.createAudit(job);
  sendEvent(job.auditId, "audit_created", { auditId: job.auditId });
  void runAudit(job.auditId, store, {
    onEvent: (event, payload) => sendEvent(job.auditId, event, payload),
    isCancelled: () => cancelled.has(job.auditId)
  }).finally(() => {
    cancelled.delete(job.auditId);
    sendEvent(job.auditId, "progress", store.getProgress(job.auditId) as unknown as Record<string, unknown>);
  });
  response.status(201).json(serializeAudit(job.auditId));
});

app.get("/api/audits", (_request, response) => {
  response.json({
    audits: store.listAudits().map((audit) => ({
      ...audit,
      progress: store.getProgress(audit.auditId),
      reportUrl: audit.reportPath ? `/api/audits/${audit.auditId}/report.pdf` : null
    }))
  });
});

app.get("/api/audits/:auditId", (request, response) => {
  const payload = serializeAudit(request.params.auditId);
  if (!payload) {
    response.status(404).json({ error: "Audit not found" });
    return;
  }
  response.json(payload);
});

app.get("/api/audits/:auditId/events", (request, response) => {
  const { auditId } = request.params;
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  response.write(`event: progress\ndata: ${JSON.stringify(store.getProgress(auditId))}\n\n`);
  const set = clients.get(auditId) ?? new Set<express.Response>();
  set.add(response);
  clients.set(auditId, set);
  request.on("close", () => {
    set.delete(response);
    if (set.size === 0) clients.delete(auditId);
  });
});

app.get("/api/audits/:auditId/report.pdf", (request, response) => {
  const audit = store.getAudit(request.params.auditId);
  if (!audit?.reportPath) {
    response.status(404).json({ error: "Report not ready" });
    return;
  }
  response.download(path.resolve(audit.reportPath), `website-audit-${request.params.auditId}.pdf`);
});

app.get("/api/audits/:auditId/report.html", (request, response) => {
  const artifactStatus = store.getArtifactStatus(request.params.auditId);
  if (!artifactStatus.reportHtmlPath) {
    response.status(404).json({ error: "HTML report not ready" });
    return;
  }
  response.sendFile(path.resolve(artifactStatus.reportHtmlPath));
});

app.post("/api/audits/:auditId/cancel", (request, response) => {
  const audit = store.getAudit(request.params.auditId);
  if (!audit) {
    response.status(404).json({ error: "Audit not found" });
    return;
  }
  cancelled.add(request.params.auditId);
  store.updateAudit(request.params.auditId, { status: "cancelled", cancelledAt: new Date().toISOString() });
  sendEvent(request.params.auditId, "audit_cancelled", { auditId: request.params.auditId });
  response.json(serializeAudit(request.params.auditId));
});

if (existsSync(webIndexPath)) {
  app.use(express.static(webDistPath));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/") || request.path.startsWith("/files/")) {
      next();
      return;
    }
    response.sendFile(webIndexPath);
  });
}

const interruptedCount = store.failInterruptedAudits();
if (interruptedCount > 0) {
  console.log(`Marked ${interruptedCount} interrupted audit(s) as failed after startup.`);
}

app.listen(port, () => {
  console.log(`Audit API listening on http://localhost:${port}`);
});
