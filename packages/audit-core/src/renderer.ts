import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "playwright";
import { chromium, devices } from "playwright";
import type { AuditSettings, PageExtract } from "./types.js";
import { slugForUrl } from "./urlRules.js";

export interface RenderResult {
  extract: PageExtract;
  links: string[];
  desktopScreenshotPath?: string;
  mobileScreenshotPath?: string;
  statusCode: number;
  contentType: string;
}

async function preparePage(page: Page, url: string): Promise<{ statusCode: number; contentType: string }> {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(`(async () => {
    await document.fonts?.ready?.catch?.(() => undefined);
    await Promise.all(
      Array.from(document.images)
        .filter((image) => !image.complete)
        .slice(0, 50)
        .map(
          (image) =>
            new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
              setTimeout(resolve, 1500);
            })
        )
    );
  })()`).catch(() => undefined);
  await page.evaluate(`(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((resolve) => setTimeout(resolve, 600));
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
  })()`).catch(() => undefined);
  return {
    statusCode: response?.status() ?? 0,
    contentType: response?.headers()["content-type"] ?? ""
  };
}

async function extractFromPage(page: Page, url: string, statusCode: number, contentType: string): Promise<PageExtract & { links: string[] }> {
  const currentUrlJson = JSON.stringify(url);
  const contentTypeJson = JSON.stringify(contentType);
  return page.evaluate(`(() => {
      const currentUrl = ${currentUrlJson};
      const status = ${statusCode};
      const type = ${contentTypeJson};
      const text = (value) => (value ?? "").replace(/\s+/g, " ").trim();
      const absolute = (href) => {
        if (!href) return "";
        try {
          return new URL(href, window.location.href).toString();
        } catch {
          return "";
        }
      };
      const title = text(document.title);
      const metaDescription = text(document.querySelector('meta[name="description"]')?.content);
      const canonicalUrl = absolute(document.querySelector('link[rel="canonical"]')?.href ?? null) || currentUrl;
      const headings = {
        h2: Array.from(document.querySelectorAll("h2")).map((node) => text(node.textContent)).filter(Boolean),
        h3: Array.from(document.querySelectorAll("h3")).map((node) => text(node.textContent)).filter(Boolean)
      };
      const h1s = Array.from(document.querySelectorAll("h1")).map((node) => text(node.textContent)).filter(Boolean);
      const visibleText = text(document.body?.innerText ?? "").slice(0, 18_000);
      const wordCount = visibleText ? visibleText.split(/\s+/).length : 0;
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const links = anchors.map((anchor) => absolute(anchor.getAttribute("href"))).filter(Boolean);
      const internalLinks = [];
      const externalLinks = [];
      links.forEach((link) => {
        try {
          const parsed = new URL(link);
          if (parsed.hostname.replace(/^www\./, "") === window.location.hostname.replace(/^www\./, "")) {
            internalLinks.push(link);
          } else {
            externalLinks.push(link);
          }
        } catch {
          // ignore malformed links
        }
      });
      const ctas = anchors
        .map((anchor) => {
          const label = text(anchor.textContent || anchor.getAttribute("aria-label") || anchor.title);
          const href = absolute(anchor.getAttribute("href"));
          const rect = anchor.getBoundingClientRect();
          const location = rect.top < 750 ? "hero" : "body";
          return { text: label, href, location };
        })
        .filter((cta) => cta.text && /apply|open|get|start|contact|buy|join|request|schedule|compare|learn/i.test(cta.text))
        .slice(0, 20);
      const forms = Array.from(document.querySelectorAll("form")).map((form) => {
        const fields = Array.from(form.querySelectorAll("input, textarea, select"))
          .map((field) => text(field.getAttribute("aria-label") || field.getAttribute("placeholder") || field.name || field.id))
          .filter(Boolean);
        const submitText = text(
          form.querySelector('button[type="submit"], button:not([type])')?.textContent ||
            form.querySelector('input[type="submit"]')?.value
        );
        return { fields, submitText };
      });
      const images = Array.from(document.querySelectorAll("img")).map((image) => ({
        src: absolute(image.getAttribute("src")),
        alt: text(image.getAttribute("alt"))
      }));
      return {
        url: currentUrl,
        title,
        metaDescription,
        canonicalUrl,
        statusCode: status,
        contentType: type,
        h1: h1s[0] ?? "",
        headings,
        visibleText,
        wordCount,
        ctas,
        internalLinks: Array.from(new Set(internalLinks)).slice(0, 150),
        externalLinks: Array.from(new Set(externalLinks)).slice(0, 100),
        forms,
        images: images.slice(0, 80),
        missingAltCount: images.filter((image) => !image.alt).length,
        hasH1: h1s.length > 0,
        h1Count: h1s.length,
        hasMetaDescription: Boolean(metaDescription),
        links: Array.from(new Set(links))
      };
    })()`);
}

export async function renderAndExtractPage(
  browser: Browser,
  url: string,
  settings: AuditSettings,
  screenshotsDir: string
): Promise<RenderResult> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const { statusCode, contentType } = await preparePage(page, url);
  const extracted = await extractFromPage(page, url, statusCode, contentType);
  const slug = slugForUrl(url);
  let desktopScreenshotPath: string | undefined;
  if (settings.screenshotDesktop) {
    desktopScreenshotPath = path.join(screenshotsDir, `${slug}-desktop.png`);
    await page.screenshot({ path: desktopScreenshotPath, fullPage: true });
  }
  await page.close();

  let mobileScreenshotPath: string | undefined;
  if (settings.screenshotMobile) {
    const mobilePage = await browser.newPage({ ...devices["iPhone 14"] });
    await preparePage(mobilePage, url);
    mobileScreenshotPath = path.join(screenshotsDir, `${slug}-mobile.png`);
    await mobilePage.screenshot({ path: mobileScreenshotPath, fullPage: true });
    await mobilePage.close();
  }

  const extract: PageExtract = {
    ...extracted,
    desktopScreenshotPath,
    mobileScreenshotPath
  };

  return {
    extract,
    links: extracted.links,
    desktopScreenshotPath,
    mobileScreenshotPath,
    statusCode,
    contentType
  };
}

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function writeExtract(filePath: string, extract: PageExtract): Promise<void> {
  await writeFile(filePath, JSON.stringify(extract, null, 2));
}
