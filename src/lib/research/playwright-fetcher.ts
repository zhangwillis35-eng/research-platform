/**
 * Playwright-based full text fetcher.
 *
 * Uses a real headless browser to:
 * 1. Navigate to the paper URL (via DOI or direct link)
 * 2. Wait for JavaScript to render the full text
 * 3. Extract the article body text
 *
 * This works with institutional access because the browser
 * inherits the machine's network (campus IP / VPN).
 */

let browserPromise: Promise<import("playwright").Browser> | null = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright");
      return chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    })();
  }
  return browserPromise;
}

export interface PlaywrightResult {
  text: string;
  source: "playwright";
  url: string;
  wordCount: number;
  truncated: boolean;
}

const MAX_TEXT = 25000;

/**
 * Fetch full text of a paper using Playwright headless browser.
 * The browser runs on the user's machine, so it uses their network
 * (campus IP / VPN) for institutional access.
 */
export async function fetchWithPlaywright(
  doi: string,
  timeoutMs: number = 20000
): Promise<PlaywrightResult | null> {
  let browser;
  let page;

  try {
    browser = await getBrowser();
    page = await browser.newPage();

    // Set a realistic user agent
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
    });

    // Navigate to DOI
    const url = `https://doi.org/${doi}`;
    console.log(`[playwright] Navigating to ${url}`);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    // Wait for content to load (publishers use JS rendering)
    await page.waitForTimeout(3000);

    // Try multiple extraction strategies based on the publisher
    const finalUrl = page.url();
    console.log(`[playwright] Landed on: ${finalUrl}`);

    let text = "";

    // Strategy 1: ScienceDirect (Elsevier)
    if (finalUrl.includes("sciencedirect.com")) {
      text = await page.evaluate(() => {
        const body = document.querySelector("#body");
        const abstract = document.querySelector(".abstract");
        const parts: string[] = [];
        if (abstract) parts.push(abstract.textContent ?? "");
        if (body) parts.push(body.textContent ?? "");
        return parts.join("\n\n").trim();
      });
    }
    // Strategy 2: Springer / Nature
    else if (finalUrl.includes("springer.com") || finalUrl.includes("nature.com")) {
      text = await page.evaluate(() => {
        const article = document.querySelector("article") ?? document.querySelector(".c-article-body");
        return article?.textContent?.trim() ?? "";
      });
    }
    // Strategy 3: Wiley
    else if (finalUrl.includes("wiley.com")) {
      text = await page.evaluate(() => {
        const body = document.querySelector(".article-section__content") ?? document.querySelector(".article__body");
        const abstract = document.querySelector(".article-section--abstract");
        const parts: string[] = [];
        if (abstract) parts.push(abstract.textContent ?? "");
        if (body) parts.push(body.textContent ?? "");
        return parts.join("\n\n").trim();
      });
    }
    // Strategy 4: SAGE
    else if (finalUrl.includes("sagepub.com")) {
      text = await page.evaluate(() => {
        const body = document.querySelector(".hlFld-Fulltext") ?? document.querySelector("article");
        return body?.textContent?.trim() ?? "";
      });
    }
    // Strategy 5: Taylor & Francis
    else if (finalUrl.includes("tandfonline.com")) {
      text = await page.evaluate(() => {
        const body = document.querySelector(".hlFld-Fulltext") ?? document.querySelector("article");
        return body?.textContent?.trim() ?? "";
      });
    }
    // Strategy 6: Science (AAAS)
    else if (finalUrl.includes("science.org")) {
      text = await page.evaluate(() => {
        const body = document.querySelector(".article__body") ?? document.querySelector("article");
        return body?.textContent?.trim() ?? "";
      });
    }
    // Generic: try <article> or main content
    else {
      text = await page.evaluate(() => {
        const candidates = [
          document.querySelector("article"),
          document.querySelector('[role="main"]'),
          document.querySelector(".article-body"),
          document.querySelector("#main-content"),
          document.querySelector(".content-body"),
        ];
        for (const el of candidates) {
          if (el && (el.textContent?.length ?? 0) > 500) {
            return el.textContent?.trim() ?? "";
          }
        }
        return "";
      });
    }

    await page.close();

    // Clean up whitespace
    text = text.replace(/\s+/g, " ").trim();

    if (text.length < 300) {
      console.log(`[playwright] Text too short (${text.length} chars), likely paywalled`);
      return null;
    }

    console.log(`[playwright] Got ${text.length} chars from ${finalUrl}`);

    return {
      text: text.slice(0, MAX_TEXT),
      source: "playwright",
      url: finalUrl,
      wordCount: text.split(/\s+/).length,
      truncated: text.length > MAX_TEXT,
    };
  } catch (err) {
    console.error(`[playwright] Error:`, (err as Error).message?.slice(0, 100));
    if (page) await page.close().catch(() => {});
    return null;
  }
}

/**
 * Close the browser instance (call on server shutdown).
 */
export async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}
