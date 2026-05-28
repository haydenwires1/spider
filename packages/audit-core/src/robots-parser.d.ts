declare module "robots-parser" {
  export interface Robot {
    isAllowed(url: string, userAgent?: string): boolean;
  }

  export default function robotsParser(url: string, contents: string): Robot;
}
