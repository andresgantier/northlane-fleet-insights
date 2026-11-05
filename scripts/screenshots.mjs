// Screenshots for the README (npm run screenshots [base-url]).
// Uses the locally installed Chrome; signs in through the "Explore the demo" buttons.
// Asks the assistant two questions (uses a little Gemini quota); never confirms an FRC.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "https://northlane-fleet-insights.vercel.app";
const OUT = "docs/images";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });

async function signIn(page, role) {
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: new RegExp(role, "i") }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function shot(page, path, name, waitFor, fullPage = false) {
  if (path) await page.goto(BASE + path);
  if (waitFor) await page.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 60000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200); // charts finish drawing
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log("saved", name);
}

async function ask(page, question, waitFor) {
  await page.goto(`${BASE}/assistant`);
  await page.getByLabel("Your question").fill(question);
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 90000 });
}

// Desktop: Fleet Operations
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await desktop.newPage();
await signIn(page, "Fleet Operations");
await shot(page, "/", "dashboard", "Critical cases");
await shot(page, "/vehicles/636", "vehicle-timeline", "Downtime days per month");
await shot(page, "/vehicles/22?tab=details", "vehicle-rules", "Is this a critical case?");
await ask(page, "¿Qué remolques pasaron más de 20 días parados en los últimos 6 meses?", "How was this calculated?");
await page.getByText("How was this calculated?").first().click();
await shot(page, null, "assistant", null, true);
await ask(page, "Open a Fleet Review Case for vehicle 22", "Proposal: open a Fleet Review Case");
await shot(page, null, "frc-proposal", null);
await shot(page, "/evaluation", "evaluation", "Correct answers");
await desktop.close();

// Phone: depot supervisor
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
const mobile = await phone.newPage();
await signIn(mobile, "Depot Supervisor");
await shot(mobile, "/", "supervisor-mobile", "Critical cases");
await phone.close();

await browser.close();
