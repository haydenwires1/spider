import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import type { AuditJob, CrawledPage, ExcludedUrl, PageAnalysis, PageExtract } from "./types.js";

interface ReportPage {
  page: CrawledPage;
  extract: PageExtract;
  analysis: PageAnalysis;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function imgSrc(filePath?: string | null): Promise<string> {
  if (!filePath) return "";
  const data = await readFile(filePath);
  return `data:image/png;base64,${data.toString("base64")}`;
}

async function previewImgSrc(browser: Browser, filePath?: string | null, variant: "desktop" | "mobile" = "desktop"): Promise<string> {
  if (!filePath) return "";
  const page = await browser.newPage({
    viewport: variant === "desktop" ? { width: 900, height: 620 } : { width: 280, height: 620 }
  });
  try {
    const imageUrl = pathToFileURL(filePath).toString();
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:white"><img src="${imageUrl}" style="display:block;width:100%;height:auto" /></body></html>`,
      { waitUntil: "load", timeout: 15_000 }
    );
    const image = page.locator("img");
    const data = await image.screenshot({ type: "jpeg", quality: 68 });
    return `data:image/jpeg;base64,${data.toString("base64")}`;
  } catch {
    return imgSrc(filePath);
  } finally {
    await page.close();
  }
}

function scoreList(analysis: PageAnalysis): string {
  return Object.entries(analysis.scores)
    .map(([key, value]) => `<li><span>${escapeHtml(key)}</span><strong>${value}/10</strong></li>`)
    .join("");
}

function topSitewideIssues(pages: ReportPage[]): string[] {
  const counts = new Map<string, number>();
  for (const reportPage of pages) {
    for (const issue of reportPage.analysis.topIssues) {
      counts.set(issue.issue, (counts.get(issue.issue) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([issue, count]) => `${issue} (${count} page${count === 1 ? "" : "s"})`);
}

export async function generatePdfReport(
  audit: AuditJob,
  pages: CrawledPage[],
  excluded: ExcludedUrl[],
  outputPath: string
): Promise<string> {
  const reportPages: ReportPage[] = [];
  for (const page of pages) {
    if (!page.extractedDataPath || !page.analysisPath) continue;
    const extract = JSON.parse(await readFile(page.extractedDataPath, "utf8")) as PageExtract;
    const analysis = JSON.parse(await readFile(page.analysisPath, "utf8")) as PageAnalysis;
    reportPages.push({ page, extract, analysis });
  }

  const highPriority = reportPages.filter((item) => item.analysis.overallPriority === "High");
  const sitewide = topSitewideIssues(reportPages);

  const browser = await chromium.launch({ headless: true });
  try {
    const pageSections: string[] = [];
    for (const { page, extract, analysis } of reportPages) {
      const desktop = await previewImgSrc(browser, page.desktopScreenshotPath, "desktop");
      const mobile = await previewImgSrc(browser, page.mobileScreenshotPath, "mobile");
      pageSections.push(
        `
          <section class="page-section">
            <h2>${escapeHtml(new URL(page.url).pathname || "/")}</h2>
            <p class="url">${escapeHtml(page.url)}</p>
            <div class="meta-row">
              <span>${escapeHtml(analysis.pageType)}</span>
              <span class="priority ${analysis.overallPriority.toLowerCase()}">${analysis.overallPriority} priority</span>
              <span>${analysis.source === "fallback" ? "Local fallback analysis" : "OpenAI analysis"}</span>
            </div>
            <p>${escapeHtml(analysis.summary)}</p>
            <div class="scores"><ul>${scoreList(analysis)}</ul></div>
            <h3>Top Issues</h3>
            ${analysis.topIssues
              .map(
                (issue) => `
                  <div class="issue">
                    <strong>${escapeHtml(issue.priority)}: ${escapeHtml(issue.issue)}</strong>
                    <p>${escapeHtml(issue.whyItMatters)}</p>
                    <p><b>Recommendation:</b> ${escapeHtml(issue.recommendation)}</p>
                  </div>
                `
              )
              .join("")}
            <h3>Suggested Copy Changes</h3>
            ${
              analysis.recommendedCopyChanges.length
                ? analysis.recommendedCopyChanges
                    .map(
                      (change) => `
                      <div class="copy-change">
                        <p><b>Current:</b> ${escapeHtml(change.current)}</p>
                        <p><b>Suggested:</b> ${escapeHtml(change.suggested)}</p>
                        <p>${escapeHtml(change.reason)}</p>
                      </div>`
                    )
                    .join("")
                : "<p>No copy rewrites generated for this page.</p>"
            }
            <h3>Design Recommendations</h3>
            <ul>${analysis.designRecommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            <h3>Internal Linking Recommendations</h3>
            <ul>${analysis.internalLinkingRecommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            <h3>Screenshot Previews</h3>
            <div class="screens">
              ${desktop ? `<figure><figcaption>Desktop preview</figcaption><img class="desktop" src="${desktop}" /></figure>` : ""}
              ${mobile ? `<figure><figcaption>Mobile preview</figcaption><img class="mobile" src="${mobile}" /></figure>` : ""}
            </div>
            <p class="small">Title: ${escapeHtml(extract.title)} | Words: ${extract.wordCount} | H1 count: ${extract.h1Count} | Missing alt text: ${extract.missingAltCount}</p>
            <p class="small">Full screenshots: ${escapeHtml(page.desktopScreenshotPath ?? "No desktop screenshot")} | ${escapeHtml(page.mobileScreenshotPath ?? "No mobile screenshot")}</p>
          </section>
        `
      );
    }

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Website Audit Report</title>
          <style>
            @page { margin: 42px; }
            body { font-family: Inter, Arial, sans-serif; color: #172026; line-height: 1.45; }
            h1 { font-size: 34px; margin: 0 0 8px; }
            h2 { font-size: 24px; margin: 34px 0 4px; page-break-after: avoid; }
            h3 { font-size: 15px; margin: 20px 0 8px; color: #39444d; text-transform: uppercase; letter-spacing: .04em; }
            p, li { font-size: 12px; }
            .cover { border-bottom: 2px solid #172026; padding-bottom: 24px; margin-bottom: 24px; }
            .url, .small { color: #66717a; font-size: 10px; overflow-wrap: anywhere; }
            .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
            .stat { border: 1px solid #dce2e8; border-radius: 8px; padding: 12px; }
            .stat strong { display: block; font-size: 22px; }
            .meta-row { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 12px; }
            .meta-row span { border: 1px solid #dce2e8; border-radius: 999px; padding: 4px 8px; font-size: 10px; }
            .priority.high { background: #ffe8e0; border-color: #ffb49c; }
            .priority.medium { background: #fff3d6; border-color: #ffd676; }
            .priority.low { background: #e8f6ee; border-color: #9ed8b7; }
            .scores ul { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 0; list-style: none; }
            .scores li { border: 1px solid #dce2e8; border-radius: 6px; padding: 8px; display: flex; justify-content: space-between; }
            .issue, .copy-change { border-left: 3px solid #334155; padding: 8px 10px; background: #f8fafc; margin: 8px 0; }
            .page-section { page-break-before: always; }
            .screens { display: grid; grid-template-columns: 1fr 180px; gap: 16px; align-items: start; }
            figure { margin: 0; }
            figcaption { font-size: 10px; font-weight: 700; margin-bottom: 4px; }
            img { border: 1px solid #dce2e8; border-radius: 6px; max-width: 100%; max-height: 420px; object-fit: contain; object-position: top; }
            .mobile { max-height: 420px; }
            .appendix li { overflow-wrap: anywhere; }
          </style>
        </head>
        <body>
          <section class="cover">
            <h1>Website Audit Report</h1>
            <p>${escapeHtml(audit.startUrl)}</p>
            <p>Generated ${escapeHtml(new Date().toLocaleString())}</p>
            <div class="grid">
              <div class="stat"><strong>${pages.length}</strong><span>Pages discovered</span></div>
              <div class="stat"><strong>${reportPages.length}</strong><span>Pages audited</span></div>
              <div class="stat"><strong>${highPriority.length}</strong><span>High priority pages</span></div>
              <div class="stat"><strong>${excluded.length}</strong><span>Excluded URLs</span></div>
            </div>
          </section>
          <section>
            <h2>Executive Summary</h2>
            <p>The audit reviewed ${reportPages.length} pages across ${escapeHtml(audit.domain)}. The most common themes are listed below and should be used to prioritize human review.</p>
            <h3>Sitewide Themes</h3>
            <ul>${sitewide.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No repeated issues found.</li>"}</ul>
            <h3>Highest-Priority Recommendations</h3>
            <ul>${highPriority
              .slice(0, 10)
              .map((item) => `<li>${escapeHtml(item.page.url)}: ${escapeHtml(item.analysis.topIssues[0]?.recommendation ?? item.analysis.summary)}</li>`)
              .join("") || "<li>No high-priority pages detected.</li>"}</ul>
          </section>
          ${pageSections.join("\n")}
          <section class="page-section appendix">
            <h2>Appendix</h2>
            <h3>Crawled URLs</h3>
            <ul>${pages.map((page) => `<li>${escapeHtml(page.url)} - ${escapeHtml(page.status)}</li>`).join("")}</ul>
            <h3>Full Screenshot Files</h3>
            <ul>${pages
              .filter((page) => page.desktopScreenshotPath || page.mobileScreenshotPath)
              .map(
                (page) =>
                  `<li>${escapeHtml(page.url)}<br/>Desktop: ${escapeHtml(page.desktopScreenshotPath ?? "none")}<br/>Mobile: ${escapeHtml(page.mobileScreenshotPath ?? "none")}</li>`
              )
              .join("")}</ul>
            <h3>Excluded URLs</h3>
            <ul>${excluded.map((item) => `<li>${escapeHtml(item.url)} - ${escapeHtml(item.reason)}</li>`).join("")}</ul>
          </section>
        </body>
      </html>
    `;

    const htmlPath = outputPath.replace(/\.pdf$/, ".html");
    await writeFile(htmlPath, html);
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
      page.setDefaultTimeout(120_000);
      await page.pdf({ path: outputPath, format: "Letter", printBackground: true });
    } finally {
      await page.close();
    }
    return outputPath;
  } finally {
    await browser.close();
  }
}
