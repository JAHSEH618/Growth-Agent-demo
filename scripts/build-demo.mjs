// Wraps src/demo/index.html into the sandboxed shell and writes public/demo.html.
// The deployed artifact keeps the whole demo escaped inside one srcdoc attribute,
// so the readable source lives here and the escaping happens at build time.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Matches the escaping the srcdoc attribute was originally authored with.
function escapeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

const [shell, inner] = await Promise.all([
  readFile(resolve(root, "src/demo/shell.html"), "utf8"),
  readFile(resolve(root, "src/demo/index.html"), "utf8"),
]);

if (!shell.includes("%%SRCDOC%%")) {
  throw new Error("src/demo/shell.html lost its %%SRCDOC%% placeholder");
}

// og:image 必须是绝对地址,抓取器不解相对路径。Vercel 在构建时给出域名;
// 本地构建没有域名,留空退回同源相对路径,本地预览照常。
const host =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? "";
const origin = host ? `https://${host}` : "";

// Function replacement: the escaped payload may contain `$`, which the string
// form of String#replace would treat as a substitution pattern.
const escaped = escapeAttribute(inner);
await writeFile(
  resolve(root, "public/demo.html"),
  shell.replaceAll("%%ORIGIN%%", origin).replace("%%SRCDOC%%", () => escaped),
);
