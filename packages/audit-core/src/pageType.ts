import type { PageExtract } from "./types.js";

export function classifyPage(extract: Pick<PageExtract, "url" | "title" | "h1" | "forms" | "ctas">): string {
  const url = new URL(extract.url);
  const path = url.pathname.toLowerCase();
  const text = `${extract.title} ${extract.h1}`.toLowerCase();
  if (path === "/" || path === "") return "Homepage";
  if (path.includes("blog") || path.includes("news") || path.includes("article")) return "Blog/article";
  if (path.includes("faq") || text.includes("frequently asked")) return "FAQ page";
  if (path.includes("contact") || text.includes("contact")) return "Contact page";
  if (path.includes("support") || path.includes("help")) return "Support page";
  if (path.includes("location") || path.includes("branch")) return "Branch/location page";
  if (path.includes("apply") || extract.forms.length > 0) return "Application page";
  if (path.includes("campaign") || path.includes("promo")) return "Campaign page";
  if (extract.ctas.some((cta) => /buy|apply|open|get started|request|book/i.test(cta.text))) return "Landing page";
  if (/account|loan|checking|savings|card|product|service/.test(path + text)) return "Product page";
  return "Other";
}
