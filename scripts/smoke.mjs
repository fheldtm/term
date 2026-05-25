import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.SMOKE_URL || "http://127.0.0.1:5174/";
const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const tempDir = await mkdtemp(path.join(tmpdir(), "terminal-composer-smoke-"));
const samplePath = path.join(tempDir, "sample-log.txt");

await writeFile(samplePath, "smoke test log\n", "utf8");

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"]
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("SSH connection").getByText("demo@192.168.0.210").waitFor({ timeout: 8000 });

  const composer = page.getByLabel("터미널에 보낼 내용");
  await composer.fill("이 로그를 확인해줘");
  await page.locator('input[type="file"]').setInputFiles(samplePath);
  await page.locator(".attachment-tile").filter({ hasText: "[_file1]" }).waitFor({ timeout: 4000 });
  await page.getByLabel("터미널로 제출").click();
  await page.getByText("User uploaded files").waitFor({ timeout: 8000 });
  await page.getByText("/home/fheldtm/.terminal-composer/uploads").waitFor({ timeout: 8000 });
  console.log("smoke ok");
} finally {
  await browser.close();
  await rm(tempDir, { recursive: true, force: true });
}
