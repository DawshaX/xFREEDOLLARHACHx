/*
 * Safe, invalid-marker-only reproduction for Crypto.com disable-2fa URL disclosure.
 *
 * The sensitive disable-2fa POST is intercepted and fulfilled locally. It never
 * reaches Crypto.com. No real token, account, credential, or 2FA state is used.
 * Output is allowlisted and excludes cookies, client IDs, and unrelated requests.
 *
 * Run: node disable_2fa_magic_token_disclosure.js [output.json]
 * Requires: npm install playwright && npx playwright install chromium
 */
const { chromium } = require("playwright");
const { randomBytes } = require("crypto");
const fs = require("fs");
const path = require("path");

const outputPath = path.resolve(
  process.argv[2] || "magic-token-disclosure-evidence.json",
);
const marker = `CYBERNOVA-INVALID-NOT-REAL-${randomBytes(8).toString("hex")}`;
const target = `https://crypto.com/exchange/disable-2fa?magic_token=${encodeURIComponent(marker)}`;
const watchedHosts = new Map([
  ["insights.rtgio.co", "RTG pageview"],
  ["www.google.com", "Google Ads measurement"],
  ["googleads.g.doubleclick.net", "Google Ads measurement"],
  ["analytics.google.com", "Google Analytics"],
  ["www.google-analytics.com", "Google Analytics"],
  ["notify.bugsnag.com", "Bugsnag error monitoring"],
]);

function markerFields(rawUrl) {
  const url = new URL(rawUrl);
  const fields = [];
  for (const [key, value] of url.searchParams) {
    if (value.includes(marker)) fields.push(`query.${key}`);
  }
  return fields;
}

function bugsnagPaths(value, current = "$", found = []) {
  if (typeof value === "string") {
    if (value.includes(marker)) found.push(current);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => bugsnagPaths(item, `${current}[${index}]`, found));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      bugsnagPaths(item, `${current}.${key}`, found);
    }
  }
  return found;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  const disclosures = [];
  const responses = [];
  const errors = [];
  const intercepted = [];
  const startedAt = new Date().toISOString();

  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
  await page.route("**/security/disable_2fa_by_magic_link*", async (route) => {
    intercepted.push({
      method: route.request().method(),
      endpoint: "https://exchange-be.crypto.com/security/disable_2fa_by_magic_link",
      locallyFulfilled: true,
      requestReachedBackend: false,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 10016, msg: "Local invalid-marker interception" }),
    });
  });

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!watchedHosts.has(url.hostname)) return;
    const body = request.postData() || "";
    const fields = markerFields(request.url());
    if (url.hostname === "notify.bugsnag.com" && body.includes(marker)) {
      try {
        fields.push(...bugsnagPaths(JSON.parse(body)));
      } catch {
        fields.push("postBody(unparsed)");
      }
    }
    if (fields.length) {
      disclosures.push({
        at: new Date().toISOString(),
        service: watchedHosts.get(url.hostname),
        host: url.hostname,
        path: url.pathname,
        method: request.method(),
        markerLocations: [...new Set(fields)],
        completeTargetUrlDisclosed: true,
      });
    }
  });

  page.on("response", (response) => {
    const host = new URL(response.url()).hostname;
    if (watchedHosts.has(host) && response.url().includes(marker)) {
      responses.push({ host, status: response.status() });
    }
  });

  let navigationStatus = null;
  try {
    const response = await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    navigationStatus = response && response.status();
    await page.waitForTimeout(20000);
  } catch (error) {
    errors.push(String(error).slice(0, 300));
  }

  const evidence = {
    schema: "cybernova.invalid-marker-disclosure.v1",
    startedAt,
    finishedAt: new Date().toISOString(),
    targetPath: "/exchange/disable-2fa?magic_token=<INVALID_MARKER>",
    markerIsDeliberatelyInvalid: true,
    navigationStatus,
    interceptedSensitivePosts: intercepted,
    thirdPartyDisclosures: disclosures,
    completedThirdPartyResponses: responses,
    pageErrors: errors,
    limitations: [
      "No real magic token was used.",
      "The sensitive disable-2fa POST was locally fulfilled and did not reach the backend.",
      "Provider-side access, token usability after disclosure, and account takeover were not tested or established.",
    ],
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
