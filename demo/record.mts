// Records the dashboard shots for the demo video (demo/shot-list.md, beats 3–5) into demo/takes/.
//
//   pnpm demo:record save         right after the live call: keep the data so `after-call` can be retaken
//   pnpm demo:record after-call   beat 3: the list, Sato's page after the call, the snow helper accepting
//   pnpm demo:record no-answer    beat 4: the missed-call ladder, to its end
//   pnpm demo:record map          beat 5: the map
//
// Add --en for the English dashboard. Needs `pnpm dev` running with DEMO_MODE=1, Google Chrome, and ffmpeg for the .mp4.
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";

const [shot, ...flags] = process.argv.slice(2);
const BASE = "http://localhost:3000";
const DATA = path.resolve(process.env.DATA_DIR ?? ".data");
const TAKES = path.resolve("demo/takes");
const SNAPSHOT = path.join(TAKES, "after-call-data");
const exists = (p: string) => stat(p).then(() => true, () => false);

const shots: Record<string, (page: Page) => Promise<void>> = {
  async "after-call"(page) {
    await page.goto("/");
    await pause(page, 3);
    await click(page.getByRole("link", { name: /佐藤|Sato/ }).first());
    await pause(page, 3);
    const accept = page.getByRole("button", { name: /引き受ける（デモ）|accept for .* \(demo\)/ });
    if (!(await accept.count())) throw new Error("Sato has no open snow request. Do the live call first (shot-list beat 2).");
    await scrollTo(page, page.getByText(/^(まとめ|Summary)$/).first());
    await pause(page, 4);
    await scrollTo(page, page.getByText(/^(送ったメッセージ|Messages sent)$/).first());
    await pause(page, 4);
    await scrollTo(page, accept);
    await click(accept);
    await page.getByText(/引き受けました|accepted/).first().waitFor();
    await pause(page, 4);
  },

  async "no-answer"(page) {
    await page.goto("/residents/sato");
    await pause(page, 2);
    const button = page.getByRole("button", { name: /電話に出ない（デモ）|No answer \(demo\)/ });
    if (await button.isDisabled()) throw new Error("A missed-call ladder is already running, or Sato is paused. Wait a minute or press デモをリセット.");
    await click(button);
    // 10 s to the family check, 20 s more to the end, unless the family taps 無事です on LINE first.
    await page.locator("li span.bg-red-600, li span.bg-green-600").waitFor({ timeout: 90_000 });
    await pause(page, 5);
  },

  async map(page) {
    await page.goto("/");
    await pause(page, 1.5);
    await click(page.getByRole("link", { name: /^(地図|Map)$/ }));
    await page.locator(".leaflet-tile-loaded").first().waitFor();
    await scrollTo(page, page.locator(".leaflet-container"), "end"); // "end" keeps the map credit in frame
    await pause(page, 7);
  },
};

const pause = (page: Page, seconds: number) => page.waitForTimeout(seconds * 1000);

async function click(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.page().waitForTimeout(700); // let the cursor arrive before the click
  await target.click();
}

async function scrollTo(page: Page, target: Locator, block: ScrollLogicalPosition = "center") {
  await target.evaluate((el, block) => el.scrollIntoView({ behavior: "smooth", block }), block);
  await pause(page, 1.5);
}

async function record(name: string) {
  const auth = { username: "demo", password: process.env.DASHBOARD_PASSWORD ?? "" };
  // The dev server compiles a page on its first visit: do that now, not on camera.
  const headers = { authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}` };
  await Promise.all(["/", "/?view=map", "/residents/sato"].map((p) => fetch(BASE + p, { headers })));

  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    baseURL: BASE,
    httpCredentials: auth,
    // Video is recorded at CSS pixels: a full-HD viewport, with the page zoomed 2x below so it reads at 960x540.
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: TAKES,
      size: { width: 1920, height: 1080 },
      fps: 30,
      showActions: { cursor: "pointer", style: { title: "display: none" } },
    },
  });
  await context.addInitScript(() => {
    addEventListener("DOMContentLoaded", () => {
      document.documentElement.style.zoom = "2";
      // The Next.js dev badge.
      document.head.append(Object.assign(document.createElement("style"), { textContent: "nextjs-portal { display: none }" }));
    });
  });
  if (flags.includes("--en")) await context.addCookies([{ name: "lang", value: "en", url: BASE }]);
  const page = await context.newPage();
  try {
    await shots[name](page);
  } finally {
    await context.close(); // writes the video
    await browser.close();
  }
  const webm = await page.video()!.path();
  const mp4 = path.join(TAKES, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`);
  // Editors such as DaVinci Resolve don't open Playwright's VP8 .webm.
  execFileSync("ffmpeg", ["-loglevel", "error", "-i", webm, "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", mp4]);
  await rm(webm);
  console.log(mp4);
}

await mkdir(TAKES, { recursive: true });
if (shot === "save") {
  await rm(SNAPSHOT, { recursive: true, force: true });
  await cp(DATA, SNAPSHOT, { recursive: true });
  console.log(`Saved ${DATA} to ${SNAPSHOT}. Each after-call take starts from it.`);
} else if (shots[shot]) {
  if (shot === "after-call" && (await exists(SNAPSHOT))) {
    await rm(DATA, { recursive: true, force: true });
    await cp(SNAPSHOT, DATA, { recursive: true });
  }
  await record(shot);
} else {
  console.error(`Usage: pnpm demo:record <save | ${Object.keys(shots).join(" | ")}> [--en]`);
  process.exit(1);
}
