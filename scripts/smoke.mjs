import { chromium } from "playwright-core";

const baseUrl = process.env.SMOKE_URL || "http://127.0.0.1:5174/";
const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"]
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  await page.getByLabel("SSH connection").getByText("연결되지 않음").waitFor({ timeout: 8000 });
  await page.locator(".file-explorer .empty-state strong").filter({ hasText: "SSH 세션을 연결하세요" }).waitFor({
    timeout: 8000
  });
  await page.getByRole("button", { name: "SSH 설정" }).click();
  await page.getByLabel("Host").fill("example.com");
  await page.getByLabel("User").fill("user");

  const demoTextCount = await page.getByText("demo@192.168.0.210").count();
  if (demoTextCount > 0) {
    throw new Error("demo session text should not be visible");
  }

  console.log("smoke ok");
} finally {
  await browser.close();
}
