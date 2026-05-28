export type AuditStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type PageStatus = "queued" | "crawled" | "failed" | "skipped";
export type AuditType = "Marketing" | "UX" | "SEO" | "Conversion" | "Accessibility" | "Full";
export type Priority = "High" | "Medium" | "Low";

export interface AuditSettings {
  startUrl: string;
  crawlDepth: number;
  maxPages: number;
  includeBlog: boolean;
  includePdfs: boolean;
  screenshotDesktop: boolean;
  screenshotMobile: boolean;
  auditType: AuditType;
  businessGoal?: string;
  includeSubdomains?: boolean;
  respectRobotsTxt?: boolean;
}

export interface AuditJob extends AuditSettings {
  auditId: string;
  domain: string;
  status: AuditStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  error?: string | null;
  reportPath?: string | null;
  cancelledAt?: string | null;
}

export interface AuditEvent {
  id: number;
  auditId: string;
  event: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CrawlCandidate {
  url: string;
  normalizedUrl: string;
  depth: number;
}

export interface ExcludedUrl {
  auditId: string;
  url: string;
  reason: string;
  createdAt: string;
}

export interface CrawledPage {
  pageId: string;
  auditId: string;
  url: string;
  normalizedUrl: string;
  depth: number;
  status: PageStatus;
  statusCode?: number | null;
  contentType?: string | null;
  pageType?: string | null;
  desktopScreenshotPath?: string | null;
  mobileScreenshotPath?: string | null;
  extractedDataPath?: string | null;
  analysisPath?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageExtract {
  url: string;
  title: string;
  metaDescription: string;
  canonicalUrl: string;
  statusCode: number;
  contentType: string;
  h1: string;
  headings: {
    h2: string[];
    h3: string[];
  };
  visibleText: string;
  wordCount: number;
  ctas: Array<{ text: string; href: string; location: string }>;
  internalLinks: string[];
  externalLinks: string[];
  forms: Array<{ fields: string[]; submitText: string }>;
  images: Array<{ src: string; alt: string }>;
  missingAltCount: number;
  hasH1: boolean;
  h1Count: number;
  hasMetaDescription: boolean;
  desktopScreenshotPath?: string;
  mobileScreenshotPath?: string;
}

export interface PageAnalysis {
  url: string;
  pageType: string;
  summary: string;
  scores: {
    clarity: number;
    copywriting: number;
    visualHierarchy: number;
    mobileExperience: number;
    conversionPath: number;
    seoStructure: number;
  };
  topIssues: Array<{
    priority: Priority;
    issue: string;
    whyItMatters: string;
    recommendation: string;
  }>;
  recommendedCopyChanges: Array<{
    current: string;
    suggested: string;
    reason: string;
  }>;
  designRecommendations: string[];
  internalLinkingRecommendations: string[];
  overallPriority: Priority;
  source: "openai" | "fallback";
}

export interface AuditProgress {
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

export interface ArtifactStatus {
  screenshotCount: number;
  extractedDataCount: number;
  analysisCount: number;
  openAiAnalysisCount: number;
  fallbackAnalysisCount: number;
  reportHtmlReady: boolean;
  reportPdfReady: boolean;
  reportHtmlPath?: string | null;
  reportPdfPath?: string | null;
}

export interface AuditDiagnostics {
  phase: "Queued" | "Crawling" | "Capturing screenshots" | "Analyzing pages" | "Generating PDF" | "Completed" | "Failed" | "Cancelled";
  tone: "idle" | "running" | "success" | "warning" | "danger";
  message: string;
  failureStage?: "crawl" | "screenshots" | "analysis" | "pdf" | "cancelled" | "unknown";
  successIndicators: string[];
  setupWarnings: string[];
  nextActions: string[];
}

export interface CrawlCallbacks {
  onEvent?: (event: string, payload: Record<string, unknown>) => void;
  isCancelled?: () => boolean;
}
