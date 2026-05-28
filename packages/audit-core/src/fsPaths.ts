import path from "node:path";
import { mkdir } from "node:fs/promises";

export function dataRoot(): string {
  return path.resolve(process.env.AUDIT_DATA_DIR ?? path.join(process.cwd(), "data"));
}

export function auditRoot(auditId: string): string {
  return path.join(dataRoot(), "audits", auditId);
}

export async function ensureAuditDirs(auditId: string): Promise<Record<string, string>> {
  const root = auditRoot(auditId);
  const dirs = {
    root,
    screenshots: path.join(root, "screenshots"),
    extracted: path.join(root, "extracted"),
    analysis: path.join(root, "analysis")
  };
  await Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })));
  return dirs;
}

export function toPublicPath(filePath: string): string {
  const relative = path.relative(dataRoot(), filePath).split(path.sep).join("/");
  return `/files/${relative}`;
}
