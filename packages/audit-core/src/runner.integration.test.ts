import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditStore } from "./storage.js";
import { createAuditJob, runAudit } from "./runner.js";

let server: Server;
let baseUrl: string;
const integration = process.env.RUN_INTEGRATION === "1";

function page(body: string) {
  return `<!doctype html><html><head><title>Fixture</title><meta name="description" content="Fixture page"></head><body>${body}</body></html>`;
}

if (integration) {
  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = request.url ?? "/";
      response.setHeader("content-type", "text/html");
      if (url.startsWith("/robots.txt")) {
        response.end("User-agent: *\nAllow: /\n");
        return;
      }
      if (url.startsWith("/checking")) {
        response.end(
          page(`
            <h1>Checking Account</h1>
            <h2>Benefits</h2>
            <a href="/apply">Open an Account</a>
            <img src="/card.png" alt="">
          `)
        );
        return;
      }
      if (url.startsWith("/apply")) {
        response.end(
          page(`
            <h1>Apply Now</h1>
            <form><input name="First Name"><input name="Email"><button type="submit">Get Started</button></form>
          `)
        );
        return;
      }
      response.end(
        page(`
          <h1>Fixture Credit Union</h1>
          <h2>Accounts</h2>
          <a href="/checking?utm_source=email#hero">Checking</a>
          <a href="/blog/post">Blog</a>
          <a href="/login">Login</a>
        `)
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No server address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
}

describe.skipIf(!integration)("audit runner", () => {
  it("crawls fixture pages and generates a PDF report", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "audit-db-"));
    process.env.DATABASE_URL = `file:${path.join(dir, "audit.sqlite")}`;
    delete process.env.OPENAI_API_KEY;
    const store = new AuditStore();
    const job = createAuditJob({
      startUrl: baseUrl,
      crawlDepth: 2,
      maxPages: 3,
      includeBlog: false,
      includePdfs: false,
      screenshotDesktop: true,
      screenshotMobile: true,
      auditType: "Full",
      respectRobotsTxt: false
    });
    store.createAudit(job);
    await runAudit(job.auditId, store);
    const completed = store.getAudit(job.auditId);
    expect(completed?.status).toBe("completed");
    expect(completed?.reportPath).toMatch(/report\.pdf$/);
    const pages = store.listPages(job.auditId);
    expect(pages.some((item) => item.url.includes("/checking"))).toBe(true);
    expect(pages.every((item) => item.extractedDataPath || item.status === "queued")).toBe(true);
    expect(store.listExcluded(job.auditId).some((item) => item.reason === "blog-news")).toBe(true);
  });
});
