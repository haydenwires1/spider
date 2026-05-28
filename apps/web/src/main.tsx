import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  Info,
  Loader2,
  Play,
  Square,
  XCircle
} from "lucide-react";
import "./styles.css";

type AuditStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface AuditListItem {
  auditId: string;
  startUrl: string;
  status: AuditStatus;
  createdAt: string;
  reportUrl: string | null;
  progress: Progress;
}

interface Progress {
  auditId: string;
  status: AuditStatus;
  discovered: number;
  crawled: number;
  failed: number;
  excluded: number;
  analyzed: number;
  totalQueued: number;
  reportReady: boolean;
}

interface PageRow {
  url: string;
  status: string;
  depth: number;
  statusCode?: number;
  pageType?: string;
  desktopScreenshotUrl?: string | null;
  mobileScreenshotUrl?: string | null;
  error?: string;
}

interface Diagnostics {
  phase: string;
  tone: "idle" | "running" | "success" | "warning" | "danger";
  message: string;
  failureStage?: string;
  successIndicators: string[];
  setupWarnings: string[];
  nextActions: string[];
}

interface ArtifactStatus {
  screenshotCount: number;
  extractedDataCount: number;
  analysisCount: number;
  openAiAnalysisCount: number;
  fallbackAnalysisCount: number;
  reportHtmlReady: boolean;
  reportPdfReady: boolean;
  reportHtmlUrl?: string | null;
  reportPdfUrl?: string | null;
}

interface AuditEvent {
  id: number;
  event: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

interface AuditDetail {
  audit: AuditListItem & {
    crawlDepth: number;
    maxPages: number;
    auditType: string;
    businessGoal?: string;
    error?: string | null;
    reportHtmlUrl?: string | null;
  };
  progress: Progress;
  diagnostics: Diagnostics;
  artifactStatus: ArtifactStatus;
  recentEvents: AuditEvent[];
  pages: PageRow[];
  excluded: Array<{ url: string; reason: string }>;
}

const defaultForm = {
  startUrl: "",
  crawlDepth: 3,
  maxPages: 25,
  includeBlog: false,
  includePdfs: false,
  screenshotDesktop: true,
  screenshotMobile: true,
  auditType: "Full",
  businessGoal: ""
};

function statusIcon(status: AuditStatus) {
  if (status === "completed") return <CheckCircle2 size={16} />;
  if (status === "failed" || status === "cancelled") return <XCircle size={16} />;
  if (status === "running") return <Loader2 className="spin" size={16} />;
  return <Activity size={16} />;
}

function TooltipLabel({ htmlFor, label, tooltip }: { htmlFor?: string; label: string; tooltip: string }) {
  return (
    <label className="tooltip-label" htmlFor={htmlFor}>
      <span>{label}</span>
      <span className="tooltip-trigger" tabIndex={0} aria-label={`${label}: ${tooltip}`}>
        <Info size={13} />
        <span className="tooltip-bubble" role="tooltip">
          {tooltip}
        </span>
      </span>
    </label>
  );
}

function App() {
  const [form, setForm] = useState(defaultForm);
  const [audits, setAudits] = useState<AuditListItem[]>([]);
  const [activeAuditId, setActiveAuditId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFailedOnly, setShowFailedOnly] = useState(false);

  async function refreshAudits() {
    const response = await fetch("/api/audits");
    const data = await response.json();
    setAudits(data.audits ?? []);
    if (!activeAuditId && data.audits?.[0]) setActiveAuditId(data.audits[0].auditId);
  }

  async function refreshDetail(auditId: string) {
    const response = await fetch(`/api/audits/${auditId}`);
    if (!response.ok) return;
    setDetail(await response.json());
  }

  useEffect(() => {
    void refreshAudits();
    const interval = window.setInterval(() => void refreshAudits(), 5000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!activeAuditId) return;
    void refreshDetail(activeAuditId);
    const source = new EventSource(`/api/audits/${activeAuditId}/events`);
    const refresh = () => {
      void refreshDetail(activeAuditId);
      void refreshAudits();
    };
    source.addEventListener("progress", refresh);
    source.addEventListener("screenshot_completed", refresh);
    source.addEventListener("analysis_started", refresh);
    source.addEventListener("analysis_completed", refresh);
    source.addEventListener("page_completed", refresh);
    source.addEventListener("page_failed", refresh);
    source.addEventListener("report_started", refresh);
    source.addEventListener("report_failed", refresh);
    source.addEventListener("report_ready", refresh);
    source.addEventListener("audit_cancelled", refresh);
    source.addEventListener("audit_failed", refresh);
    return () => source.close();
  }, [activeAuditId]);

  async function submitAudit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          businessGoal: form.businessGoal || undefined
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ? JSON.stringify(data.error) : "Could not start audit");
      setActiveAuditId(data.audit.auditId);
      setDetail(data);
      await refreshAudits();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancelAudit() {
    if (!activeAuditId) return;
    await fetch(`/api/audits/${activeAuditId}/cancel`, { method: "POST" });
    await refreshDetail(activeAuditId);
    await refreshAudits();
  }

  const activeAudit = useMemo(
    () => detail?.audit ?? audits.find((audit) => audit.auditId === activeAuditId) ?? null,
    [audits, activeAuditId, detail]
  );
  const progress = detail?.progress ?? activeAudit?.progress;
  const progressPercent = progress ? Math.min(100, Math.round(((progress.crawled + progress.failed) / Math.max(progress.discovered, 1)) * 100)) : 0;
  const visiblePages = showFailedOnly ? (detail?.pages ?? []).filter((page) => page.status === "failed" || page.error) : detail?.pages ?? [];
  const diagnostics = detail?.diagnostics;
  const artifacts = detail?.artifactStatus;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Globe2 size={22} />
          <span>Website Audit Crawler</span>
        </div>
        <div className="job-list">
          {audits.map((audit) => (
            <button
              key={audit.auditId}
              className={`job-item ${audit.auditId === activeAuditId ? "selected" : ""}`}
              onClick={() => setActiveAuditId(audit.auditId)}
            >
              <span className={`status-dot ${audit.status}`}>{statusIcon(audit.status)}</span>
              <span>
                <strong>{new URL(audit.startUrl).hostname}</strong>
                <small>{new Date(audit.createdAt).toLocaleString()}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        <form className="audit-form" onSubmit={submitAudit}>
          <div className="field url-field">
            <TooltipLabel
              htmlFor="startUrl"
              label="Starting URL"
              tooltip="The first page the crawler visits. Internal links found from this page are used to discover more pages."
            />
            <input
              id="startUrl"
              type="url"
              placeholder="https://www.example.com"
              value={form.startUrl}
              onChange={(event) => setForm({ ...form, startUrl: event.target.value })}
              required
            />
          </div>
          <div className="field compact">
            <TooltipLabel
              htmlFor="crawlDepth"
              label="Depth"
              tooltip="How many link-hops from the starting URL to crawl. 0 = only this page, 1 = pages linked from it, 2+ = deeper linked pages."
            />
            <input
              id="crawlDepth"
              type="number"
              min={0}
              max={10}
              value={form.crawlDepth}
              onChange={(event) => setForm({ ...form, crawlDepth: Number(event.target.value) })}
            />
          </div>
          <div className="field compact">
            <TooltipLabel
              htmlFor="maxPages"
              label="Max pages"
              tooltip="The maximum number of pages to audit before stopping, even if more links are found."
            />
            <input
              id="maxPages"
              type="number"
              min={1}
              max={100}
              value={form.maxPages}
              onChange={(event) => setForm({ ...form, maxPages: Number(event.target.value) })}
            />
          </div>
          <div className="segmented-field">
            <TooltipLabel label="Audit type" tooltip="Changes the recommendation lens used by the AI report." />
            <div className="segmented" role="group" aria-label="Audit type">
              {["Marketing", "UX", "SEO", "Conversion", "Accessibility", "Full"].map((type) => (
                <button
                  key={type}
                  type="button"
                  className={form.auditType === type ? "active" : ""}
                  onClick={() => setForm({ ...form, auditType: type })}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
          <div className="toggles">
            {[
              [
                "includeBlog",
                "Blog",
                "Include or skip blog, news, article, insight, and press pages."
              ],
              [
                "includePdfs",
                "PDFs",
                "Include linked PDF files in crawl discovery. HTML pages still receive screenshots and full extraction."
              ],
              ["screenshotDesktop", "Desktop", "Capture a full-page desktop screenshot for each audited page."],
              ["screenshotMobile", "Mobile", "Capture a full-page mobile screenshot for each audited page."]
            ].map(([key, label, tooltip]) => (
              <label key={key} className="toggle">
                <input
                  type="checkbox"
                  checked={Boolean(form[key as keyof typeof form])}
                  onChange={(event) => setForm({ ...form, [key]: event.target.checked })}
                />
                <span>{label}</span>
                <span className="tooltip-trigger" tabIndex={0} aria-label={`${label}: ${tooltip}`}>
                  <Info size={13} />
                  <span className="tooltip-bubble" role="tooltip">
                    {tooltip}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="field goal-field">
            <TooltipLabel
              htmlFor="businessGoal"
              label="Business goal"
              tooltip="Optional context for the AI, such as account opens, demo requests, calls, or lead submissions."
            />
            <input
              id="businessGoal"
              placeholder="Drive account opens, demo requests, lead submissions..."
              value={form.businessGoal}
              onChange={(event) => setForm({ ...form, businessGoal: event.target.value })}
            />
          </div>
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            Run Audit
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>

        <section className="workspace">
          <div className="progress-panel">
            <div className="panel-header">
              <div>
                <h1>{activeAudit ? new URL(activeAudit.startUrl).hostname : "No audit selected"}</h1>
                <p>{activeAudit?.startUrl ?? "Start an audit to crawl pages, capture screenshots, and generate a PDF."}</p>
              </div>
              {activeAudit?.status === "running" ? (
                <button className="icon-button danger" onClick={cancelAudit} title="Cancel audit">
                  <Square size={16} />
                </button>
              ) : null}
            </div>
            <div className="progress-bar">
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <StatusPanel
              diagnostics={diagnostics}
              progress={progress}
              artifacts={artifacts}
              auditError={detail?.audit.error}
            />
            <div className="metrics">
              <Metric label="Discovered" value={progress?.discovered ?? 0} />
              <Metric label="Crawled" value={progress?.crawled ?? 0} />
              <Metric label="Analyzed" value={progress?.analyzed ?? 0} />
              <Metric label="Excluded" value={progress?.excluded ?? 0} />
              <Metric label="Failed" value={progress?.failed ?? 0} />
            </div>

            <div className="table-toolbar">
              <h2>Pages</h2>
              <button
                type="button"
                className={`filter-button ${showFailedOnly ? "active" : ""}`}
                onClick={() => setShowFailedOnly(!showFailedOnly)}
                disabled={!detail}
              >
                Failed pages {progress?.failed ?? 0}
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Depth</th>
                    <th>HTTP</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePages.map((page) => (
                    <tr key={`${page.url}-${page.depth}`}>
                      <td>
                        <span className="page-url">{page.url}</span>
                        {page.error ? <small className="error">{page.error}</small> : null}
                      </td>
                      <td>{page.status}</td>
                      <td>{page.pageType ?? "Pending"}</td>
                      <td>{page.depth}</td>
                      <td>{page.statusCode ?? ""}</td>
                    </tr>
                  ))}
                  {visiblePages.length === 0 ? (
                    <tr>
                      <td colSpan={5}>{showFailedOnly ? "No failed page rows for this audit." : "No pages have been recorded yet."}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="report-panel">
            <div className="report-card">
              <FileText size={26} />
              <h2>PDF Report</h2>
              <p>
                {artifacts?.reportPdfReady
                  ? "Report generated and ready to download."
                  : artifacts?.reportHtmlReady
                    ? "PDF failed or is still pending, but an HTML report artifact is available."
                    : "The report appears here when crawling and analysis finish."}
              </p>
              {activeAudit?.reportUrl ? (
                <a className="download-button" href={activeAudit.reportUrl}>
                  <Download size={17} />
                  Download PDF
                </a>
              ) : (
                <button className="download-button disabled" disabled>
                  <Download size={17} />
                  Waiting
                </button>
              )}
              {detail?.audit.reportHtmlUrl ? (
                <a className="secondary-link" href={detail.audit.reportHtmlUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} />
                  Open HTML fallback
                </a>
              ) : null}
            </div>

            <div className="findings-card">
              <h2>Run Settings</h2>
              <dl>
                <dt>Status</dt>
                <dd>{activeAudit?.status ?? "Idle"}</dd>
                <dt>Audit type</dt>
                <dd>{detail?.audit.auditType ?? "Full"}</dd>
                <dt>Max pages</dt>
                <dd>{detail?.audit.maxPages ?? defaultForm.maxPages}</dd>
                <dt>Depth</dt>
                <dd>{detail?.audit.crawlDepth ?? defaultForm.crawlDepth}</dd>
              </dl>
            </div>

            <div className="findings-card">
              <h2>Artifacts</h2>
              <dl>
                <dt>Screenshots</dt>
                <dd>{artifacts?.screenshotCount ?? 0}</dd>
                <dt>Extracted data</dt>
                <dd>{artifacts?.extractedDataCount ?? 0}</dd>
                <dt>Analysis files</dt>
                <dd>{artifacts?.analysisCount ?? 0}</dd>
                <dt>PDF ready</dt>
                <dd>{artifacts?.reportPdfReady ? "Yes" : "No"}</dd>
              </dl>
            </div>

            <SetupCard artifacts={artifacts} />

            <div className="findings-card">
              <h2>Recent Events</h2>
              <div className="event-list">
                {(detail?.recentEvents ?? []).slice(-8).map((event) => (
                  <p key={event.id}>
                    <strong>{event.event.replaceAll("_", " ")}</strong>
                    <span>{new Date(event.createdAt).toLocaleTimeString()}</span>
                  </p>
                ))}
                {detail?.recentEvents.length === 0 ? <p>No events recorded yet.</p> : null}
              </div>
            </div>

            <div className="findings-card">
              <h2>Excluded URLs</h2>
              <div className="excluded-list">
                {(detail?.excluded ?? []).slice(0, 8).map((item) => (
                  <p key={item.url}>
                    <strong>{item.reason}</strong>
                    <span>{item.url}</span>
                  </p>
                ))}
                {detail?.excluded.length === 0 ? <p>No exclusions recorded.</p> : null}
              </div>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

function StatusPanel({
  diagnostics,
  progress,
  artifacts,
  auditError
}: {
  diagnostics?: Diagnostics;
  progress?: Progress;
  artifacts?: ArtifactStatus;
  auditError?: string | null;
}) {
  const checklist = [
    { label: "Pages discovered", done: (progress?.discovered ?? 0) > 0 },
    { label: "Pages crawled", done: (progress?.crawled ?? 0) > 0 },
    { label: "Screenshots saved", done: (artifacts?.screenshotCount ?? 0) > 0 },
    { label: "Pages analyzed", done: (artifacts?.analysisCount ?? 0) > 0 },
    { label: "PDF report generated", done: Boolean(artifacts?.reportPdfReady) }
  ];

  return (
    <div className={`status-panel ${diagnostics?.tone ?? "idle"}`}>
      <div className="status-heading">
        {diagnostics?.tone === "danger" ? <AlertTriangle size={18} /> : diagnostics?.tone === "success" ? <CheckCircle2 size={18} /> : <Activity size={18} />}
        <div>
          <strong>{diagnostics?.phase ?? "Idle"}</strong>
          <p>{diagnostics?.message ?? "Start an audit to see live crawl, analysis, and report status."}</p>
        </div>
      </div>

      {auditError ? (
        <div className="error-box">
          <strong>Stored error</strong>
          <code>{auditError}</code>
        </div>
      ) : null}

      <div className="status-checklist">
        {checklist.map((item) => (
          <span key={item.label} className={item.done ? "done" : ""}>
            {item.done ? <CheckCircle2 size={14} /> : <Activity size={14} />}
            {item.label}
          </span>
        ))}
      </div>

      {diagnostics?.successIndicators.length ? (
        <div className="guidance-block success-guidance">
          <strong>Success indicators</strong>
          <ul>{diagnostics.successIndicators.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}

      {diagnostics?.setupWarnings.length ? (
        <div className="guidance-block warning-guidance">
          <strong>Setup notes</strong>
          <ul>{diagnostics.setupWarnings.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}

      {diagnostics?.nextActions.length ? (
        <div className="guidance-block">
          <strong>What to try next</strong>
          <ul>{diagnostics.nextActions.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

function SetupCard({ artifacts }: { artifacts?: ArtifactStatus }) {
  const openAiReady = (artifacts?.openAiAnalysisCount ?? 0) > 0;
  const fallbackOnly = (artifacts?.fallbackAnalysisCount ?? 0) > 0 && !openAiReady;

  return (
    <div className="findings-card setup-card">
      <h2>Setup Help</h2>
      <div>
        <strong>Screenshots</strong>
        <p>Run <code>npm run playwright:install</code>. Keep Desktop or Mobile checked to capture screenshots.</p>
      </div>
      <div>
        <strong>OpenAI</strong>
        <p>Set <code>OPENAI_API_KEY</code> in <code>.env</code>. Optionally set <code>OPENAI_AUDIT_MODEL</code>, then restart the API server.</p>
        {fallbackOnly ? <p className="setup-warning">This run used local fallback analysis.</p> : null}
      </div>
      <div>
        <strong>PDF reports</strong>
        <p>PDF generation runs after crawl and analysis finish, and also requires Playwright Chromium.</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
