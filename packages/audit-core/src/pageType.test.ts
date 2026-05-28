import { describe, expect, it } from "vitest";
import { classifyPage } from "./pageType.js";

describe("page type classification", () => {
  it("classifies common page types", () => {
    expect(classifyPage({ url: "https://example.com/", title: "Home", h1: "Welcome", forms: [], ctas: [] })).toBe("Homepage");
    expect(classifyPage({ url: "https://example.com/blog/post", title: "News", h1: "Update", forms: [], ctas: [] })).toBe("Blog/article");
    expect(classifyPage({ url: "https://example.com/contact", title: "Contact", h1: "Contact us", forms: [], ctas: [] })).toBe("Contact page");
    expect(classifyPage({ url: "https://example.com/checking", title: "Checking Account", h1: "Checking", forms: [], ctas: [] })).toBe("Product page");
  });
});
