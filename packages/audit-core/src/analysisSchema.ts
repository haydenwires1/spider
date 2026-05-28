import { z } from "zod";

export const pageAnalysisSchema = z.object({
  url: z.string().url(),
  pageType: z.string().min(1),
  summary: z.string().min(1),
  scores: z.object({
    clarity: z.number().min(1).max(10),
    copywriting: z.number().min(1).max(10),
    visualHierarchy: z.number().min(1).max(10),
    mobileExperience: z.number().min(1).max(10),
    conversionPath: z.number().min(1).max(10),
    seoStructure: z.number().min(1).max(10)
  }),
  topIssues: z.array(
    z.object({
      priority: z.enum(["High", "Medium", "Low"]),
      issue: z.string().min(1),
      whyItMatters: z.string().min(1),
      recommendation: z.string().min(1)
    })
  ),
  recommendedCopyChanges: z.array(
    z.object({
      current: z.string(),
      suggested: z.string(),
      reason: z.string()
    })
  ),
  designRecommendations: z.array(z.string()),
  internalLinkingRecommendations: z.array(z.string()),
  overallPriority: z.enum(["High", "Medium", "Low"])
});

export const responseFormatSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "url",
    "pageType",
    "summary",
    "scores",
    "topIssues",
    "recommendedCopyChanges",
    "designRecommendations",
    "internalLinkingRecommendations",
    "overallPriority"
  ],
  properties: {
    url: { type: "string" },
    pageType: { type: "string" },
    summary: { type: "string" },
    scores: {
      type: "object",
      additionalProperties: false,
      required: [
        "clarity",
        "copywriting",
        "visualHierarchy",
        "mobileExperience",
        "conversionPath",
        "seoStructure"
      ],
      properties: {
        clarity: { type: "number" },
        copywriting: { type: "number" },
        visualHierarchy: { type: "number" },
        mobileExperience: { type: "number" },
        conversionPath: { type: "number" },
        seoStructure: { type: "number" }
      }
    },
    topIssues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["priority", "issue", "whyItMatters", "recommendation"],
        properties: {
          priority: { type: "string", enum: ["High", "Medium", "Low"] },
          issue: { type: "string" },
          whyItMatters: { type: "string" },
          recommendation: { type: "string" }
        }
      }
    },
    recommendedCopyChanges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["current", "suggested", "reason"],
        properties: {
          current: { type: "string" },
          suggested: { type: "string" },
          reason: { type: "string" }
        }
      }
    },
    designRecommendations: { type: "array", items: { type: "string" } },
    internalLinkingRecommendations: { type: "array", items: { type: "string" } },
    overallPriority: { type: "string", enum: ["High", "Medium", "Low"] }
  }
} as const;
