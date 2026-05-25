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
  await page.addInitScript(() => window.localStorage.clear());
  let sessionIndex = 0;
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    sessionIndex += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: `mock-${sessionIndex}`,
        mode: "ssh",
        label: "user@example.com",
        host: "example.com",
        username: "user",
        homeDir: "/home/user",
        cwd: "/home/user",
        uploadRoot: "/tmp/uploads",
        createdAt: Date.now()
      })
    });
  });
  await page.route("**/api/sessions/*/files**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        path: "/home/user",
        files: [
          {
            name: "project",
            path: "/home/user/project",
            type: "directory",
            size: 0,
            modifiedAt: Date.now()
          }
        ]
      })
    });
  });
  await page.route("**/api/sessions/*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true })
    });
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });

  await page.getByLabel("SSH connection").getByText("연결되지 않음").waitFor({ timeout: 8000 });
  await page.locator(".file-explorer .empty-state strong").filter({ hasText: "SSH 세션을 연결하세요" }).waitFor({
    timeout: 8000
  });
  await page.getByRole("button", { name: "SSH 연결" }).click();
  await page.getByRole("dialog", { name: "SSH 연결" }).waitFor({ timeout: 8000 });
  await page.getByLabel("Host").fill("example.com");
  await page.getByLabel("User").fill("user");
  await page.getByLabel("Password").fill("secret");
  await page.getByLabel("비밀번호 저장").check();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByRole("button", { name: /user@example.com/ }).waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "접속", exact: true }).click();
  if (await page.getByRole("dialog", { name: "연결 저장" }).count()) {
    throw new Error("save prompt should not appear after connecting");
  }
  await page.getByRole("button", { name: "연결 변경" }).click();
  await page.getByRole("button", { name: /user@example.com/ }).dblclick();
  await page.getByText("user@example.com").first().waitFor({ timeout: 8000 });
  await page.getByLabel("파일 탐색기 토글").click();
  const closedExplorerLayout = await page.evaluate(() => {
    const workbench = document.querySelector(".terminal-workbench")?.getBoundingClientRect();
    const toggle = document.querySelector(".explorer-toggle")?.getBoundingClientRect();
    return {
      workbenchWidth: workbench?.width ?? 0,
      toggleWidth: toggle?.width ?? 0,
      toggleLeft: toggle?.left ?? -1
    };
  });
  if (closedExplorerLayout.workbenchWidth < 800 || closedExplorerLayout.toggleWidth < 30 || closedExplorerLayout.toggleLeft < 0) {
    throw new Error(`sidebar toggle is not reachable when explorer is closed: ${JSON.stringify(closedExplorerLayout)}`);
  }
  await page.getByLabel("파일 탐색기 토글").click();
  await page.locator(".file-row").first().waitFor({ timeout: 8000 });
  await page.locator(".file-row").first().click({ button: "right" });
  await page.getByRole("menu").waitFor({ timeout: 8000 });
  await page.waitForTimeout(150);
  await page.getByRole("menu").waitFor({ timeout: 8000 });

  if (sessionIndex !== 2) {
    throw new Error(`expected two connection attempts, got ${sessionIndex}`);
  }

  const demoTextCount = await page.getByText("demo@192.168.0.210").count();
  if (demoTextCount > 0) {
    throw new Error("demo session text should not be visible");
  }

  console.log("smoke ok");
} finally {
  await browser.close();
}
