import { readFile, writeFile } from "node:fs/promises";
import OpenAI from "openai";
import type { AuditSettings, PageAnalysis, PageExtract } from "./types.js";
import { pageAnalysisSchema, responseFormatSchema } from "./analysisSchema.js";
import { classifyPage } from "./pageType.js";

async function imageToDataUrl(filePath?: string): Promise<string | null> {
  if (!filePath) return null;
  const data = await readFile(filePath);
  return `data:image/png;base64,${data.toString("base64")}`;
}

function fallbackAnalysis(extract: PageExtract): PageAnalysis {
  const pageType = classifyPage(extract);
  const issues: PageAnalysis["topIssues"] = [];
  if (!extract.hasH1 || extract.h1Count !== 1) {
    issues.push({
      priority: "High",
      issue: extract.hasH1 ? "Page has more than one H1." : "Page is missing an H1.",
      whyItMatters: "Search engines and users rely on a clear primary heading to understand page purpose.",
      recommendation: "Use one descriptive H1 that states the page topic and primary value."
    });
  }
  if (!extract.hasMetaDescription) {
    issues.push({
      priority: "Medium",
      issue: "Meta description is missing.",
      whyItMatters: "Search snippets may be less persuasive and less aligned with the page promise.",
      recommendation: "Add a concise meta description that names the offer, audience, and next step."
    });
  }
  if (extract.ctas.length === 0) {
    issues.push({
      priority: "High",
      issue: "No clear calls to action were detected.",
      whyItMatters: "Users may not know what to do next after reading the page.",
      recommendation: "Add a primary CTA near the top and repeat it at logical decision points."
    });
  }
  if (extract.missingAltCount > 0) {
    issues.push({
      priority: "Medium",
      issue: `${extract.missingAltCount} images are missing alt text.`,
      whyItMatters: "This is a potential accessibility issue for users who rely on assistive technology.",
      recommendation: "Add meaningful alt text for informative images and empty alt text for decorative images."
    });
  }

  return {
    url: extract.url,
    pageType,
    summary: "Local fallback analysis completed because OpenAI analysis was not available for this run.",
    scores: {
      clarity: extract.hasH1 ? 7 : 4,
      copywriting: extract.wordCount > 150 ? 6 : 4,
      visualHierarchy: extract.headings.h2.length > 0 ? 6 : 4,
      mobileExperience: 5,
      conversionPath: extract.ctas.length > 0 ? 6 : 3,
      seoStructure: extract.hasMetaDescription && extract.hasH1 ? 7 : 4
    },
    topIssues: issues.slice(0, 5),
    recommendedCopyChanges: extract.h1
      ? [
          {
            current: extract.h1,
            suggested: extract.h1,
            reason: "OpenAI analysis was unavailable, so copy rewrite suggestions were not generated."
          }
        ]
      : [],
    designRecommendations: [
      "Review desktop and mobile screenshots for above-the-fold message clarity.",
      "Confirm the primary CTA is visible before the user has to make a major scroll."
    ],
    internalLinkingRecommendations: [
      "Add contextual links from this page to the next most relevant product, support, or conversion page."
    ],
    overallPriority: issues.some((issue) => issue.priority === "High") ? "High" : "Medium",
    source: "fallback"
  };
}

function buildPrompt(extract: PageExtract, settings: AuditSettings): string {
  return [
    "You are a senior website strategist auditing one web page.",
    `Audit type: ${settings.auditType}.`,
    `Business goal: ${settings.businessGoal || "Not specified"}.`,
    "Return only valid JSON matching the provided schema.",
    "For accessibility observations, say potential accessibility issue unless directly proven by the extracted data.",
    "Evaluate page purpose, message hierarchy, copywriting, CTAs, visual hierarchy, mobile experience, conversion path, SEO/content structure, and usability.",
    "Be specific, practical, and page-level.",
    "",
    `Extracted data:\n${JSON.stringify({ ...extract, visibleText: extract.visibleText.slice(0, 9000) }, null, 2)}`
  ].join("\n");
}

export async function analyzePage(extract: PageExtract, settings: AuditSettings): Promise<PageAnalysis> {
  if (!process.env.OPENAI_API_KEY) return fallbackAnalysis(extract);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const desktop = await imageToDataUrl(extract.desktopScreenshotPath);
  const mobile = await imageToDataUrl(extract.mobileScreenshotPath);
  const inputContent: any[] = [{ type: "input_text", text: buildPrompt(extract, settings) }];
  if (desktop) inputContent.push({ type: "input_image", image_url: desktop, detail: "low" });
  if (mobile) inputContent.push({ type: "input_image", image_url: mobile, detail: "low" });

  const request: any = {
    model: process.env.OPENAI_AUDIT_MODEL || "gpt-5.4-mini",
    input: [{ role: "user", content: inputContent }],
    text: {
      format: {
        type: "json_schema",
        name: "page_audit_analysis",
        strict: true,
        schema: responseFormatSchema
      }
    }
  };

  try {
    const response: any = await client.responses.create(request);
    const raw = response.output_text ?? response.output?.[0]?.content?.[0]?.text;
    const parsed = pageAnalysisSchema.parse(JSON.parse(raw));
    return { ...parsed, source: "openai" };
  } catch (error) {
    const fallback = fallbackAnalysis(extract);
    fallback.summary = `OpenAI analysis failed, so local fallback analysis was used. ${error instanceof Error ? error.message : ""}`.trim();
    return fallback;
  }
}

export async function writeAnalysis(filePath: string, analysis: PageAnalysis): Promise<void> {
  await writeFile(filePath, JSON.stringify(analysis, null, 2));
}
