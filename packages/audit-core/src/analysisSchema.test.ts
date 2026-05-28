import { describe, expect, it } from "vitest";
import { pageAnalysisSchema } from "./analysisSchema.js";

describe("analysis schema", () => {
  it("accepts valid page analysis JSON", () => {
    const parsed = pageAnalysisSchema.parse({
      url: "https://example.com/checking",
      pageType: "Product page",
      summary: "Clear but needs a stronger CTA.",
      scores: {
        clarity: 8,
        copywriting: 7,
        visualHierarchy: 6,
        mobileExperience: 5,
        conversionPath: 6,
        seoStructure: 8
      },
      topIssues: [
        {
          priority: "High",
          issue: "CTA is too low.",
          whyItMatters: "Users may not find the next step.",
          recommendation: "Move the primary CTA higher."
        }
      ],
      recommendedCopyChanges: [],
      designRecommendations: ["Reduce hero height on mobile."],
      internalLinkingRecommendations: ["Link to rates page."],
      overallPriority: "High"
    });
    expect(parsed.overallPriority).toBe("High");
  });
});
