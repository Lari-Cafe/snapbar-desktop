import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  const full = resolve(process.cwd(), path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
};
const exists = (path: string) => existsSync(resolve(process.cwd(), path));
const joinPath = (...parts: string[]) => parts.join("/");

function filesUnder(dir: string): string[] {
  const full = resolve(process.cwd(), dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(resolve(process.cwd(), path)).isDirectory() ? filesUnder(path) : [path];
  });
}

const siteFiles = filesUnder("site").filter((path) => !path.endsWith(".svg"));
const allSiteText = siteFiles.map(read).join("\n");
const oldBuySlug = "com" + "prar";
const oldDoneSlug = "su" + "cesso";
const oldCancelSlug = "can" + "celado";

describe("Snapbar open-source static site", () => {
  it("ships landing, download, headers and redirects without retired pages", () => {
    for (const path of ["site/index.html", "site/download.html", "site/_headers", "site/_redirects", "site/vite.config.ts"]) {
      expect(read(path), `${path} should exist`).not.toEqual("");
    }
    for (const path of [
      joinPath("site", `${oldBuySlug}.html`),
      joinPath("site", `${oldDoneSlug}.html`),
      joinPath("site", `${oldCancelSlug}.html`),
      joinPath("site", "src", "check" + "out.ts"),
      joinPath("site", "src", "auth.ts"),
    ]) {
      expect(exists(path), `${path} should be removed`).toBe(false);
    }
    expect(read("site/_redirects")).toContain("/download /download.html 200");
    expect(read("site/_headers")).toContain("X-Frame-Options: DENY");
  });

  it("builds an open-source landing page", () => {
    const landing = read("site/index.html");
    for (const required of [
      "header class=\"site-nav\"",
      "section class=\"hero section\"",
      "id=\"features\"",
      "id=\"privacy\"",
      "id=\"download\"",
      "Open source",
      "Local-first",
      "Windows 10 and 11",
      "https://github.com/Lari-Cafe/SnapBar",
      "snapbar-overview.svg",
    ]) {
      expect(landing).toContain(required);
    }
  });

  it("has no retired access or sales copy", () => {
    const forbidden = [
      "compr" + "(ar|a)",
      "paga" + "mento",
      "pre" + "ço",
      "str" + "ipe",
      "check" + "out",
      "licen" + "[çc]a",
      "assi" + "natura",
      "entitle" + "ment",
      "snapbar" + "-pro",
      "pre" + "mium",
      "Google Backup",
    ];
    for (const pattern of forbidden) {
      expect(allSiteText).not.toMatch(new RegExp(pattern, "i"));
    }
  });
});
