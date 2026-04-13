#!/usr/bin/env npx tsx
/**
 * UpSkiller Desktop Crawler
 *
 * Launches the user's Chrome browser, crawls their logged-in apps,
 * extracts data, and sends everything to Opus 4.6 for analysis.
 *
 * Usage:
 *   npx tsx src/crawler/crawl.ts
 *   npx tsx src/crawler/crawl.ts --apps slack,quickbooks,erp
 *   npx tsx src/crawler/crawl.ts --urls "https://app.slack.com,https://myerp.com/dashboard"
 */

import { chromium, type Browser, type Page, type BrowserContext } from "playwright-core";
import Anthropic from "@anthropic-ai/sdk";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const anthropic = new Anthropic();

// ─── CONFIG ───

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium-browser"],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

const CHROME_PROFILE_PATHS: Record<string, string> = {
  darwin: path.join(os.homedir(), "Library/Application Support/Google/Chrome"),
  linux: path.join(os.homedir(), ".config/google-chrome"),
  win32: path.join(os.homedir(), "AppData\\Local\\Google\\Chrome\\User Data"),
};

// Predefined app crawl targets
const APP_CONFIGS: Record<string, AppConfig> = {
  slack: {
    name: "Slack",
    urls: ["https://app.slack.com/client"],
    pages: [
      { name: "channels", selector: "[data-qa='channel_sidebar_channels_header']", waitFor: 3000 },
    ],
    extracts: ["channels", "messages", "apps"],
  },
  quickbooks: {
    name: "QuickBooks",
    urls: ["https://qbo.intuit.com/app/homepage", "https://c1.qbo.intuit.com/app/homepage"],
    pages: [
      { name: "dashboard", path: "/app/homepage", waitFor: 3000 },
      { name: "expenses", path: "/app/expenses", waitFor: 3000 },
      { name: "vendors", path: "/app/vendorlist", waitFor: 3000 },
      { name: "reports-profit-loss", path: "/app/reportv2?token=ProfitAndLoss", waitFor: 5000 },
    ],
  },
  xero: {
    name: "Xero",
    urls: ["https://go.xero.com/Dashboard"],
    pages: [
      { name: "dashboard", path: "/Dashboard", waitFor: 3000 },
      { name: "bills", path: "/AccountsPayable/Dashboard", waitFor: 3000 },
      { name: "contacts", path: "/Contacts/Search", waitFor: 3000 },
    ],
  },
  netsuite: {
    name: "NetSuite",
    urls: ["https://system.netsuite.com"],
    pages: [
      { name: "dashboard", path: "/app/center/card.nl", waitFor: 5000 },
      { name: "vendors", path: "/app/common/entity/vendorlist.nl", waitFor: 5000 },
      { name: "transactions", path: "/app/accounting/transactions/transactionlist.nl", waitFor: 5000 },
    ],
  },
  hubspot: {
    name: "HubSpot",
    urls: ["https://app.hubspot.com"],
    pages: [
      { name: "dashboard", path: "/reports-dashboard", waitFor: 3000 },
      { name: "contacts", path: "/contacts", waitFor: 3000 },
    ],
  },
  salesforce: {
    name: "Salesforce",
    urls: ["https://login.salesforce.com"],
    pages: [
      { name: "home", path: "/lightning/page/home", waitFor: 5000 },
    ],
  },
  google_admin: {
    name: "Google Admin",
    urls: ["https://admin.google.com"],
    pages: [
      { name: "dashboard", path: "/", waitFor: 3000 },
      { name: "users", path: "/ac/users", waitFor: 3000 },
      { name: "billing", path: "/ac/billing/subscriptions", waitFor: 3000 },
      { name: "apps", path: "/ac/appslist/core", waitFor: 3000 },
    ],
  },
  gmail: {
    name: "Gmail",
    urls: ["https://mail.google.com"],
    pages: [
      { name: "inbox", path: "/mail/u/0/#search/subject%3A(invoice+OR+receipt+OR+renewal+OR+subscription)+newer_than%3A6m", waitFor: 5000 },
    ],
  },
};

type AppConfig = {
  name: string;
  urls: string[];
  pages?: { name: string; path?: string; selector?: string; waitFor?: number }[];
  extracts?: string[];
};

type CrawlResult = {
  app: string;
  page: string;
  url: string;
  title: string;
  text: string;
  tables: string[][];
  timestamp: string;
};

// ─── MAIN ───

async function main() {
  const args = process.argv.slice(2);
  const appsArg = args.find((a) => a.startsWith("--apps="))?.split("=")[1];
  const urlsArg = args.find((a) => a.startsWith("--urls="))?.split("=")[1];
  const outputArg = args.find((a) => a.startsWith("--output="))?.split("=")[1] || "/tmp/upskiller-crawl-results.json";

  console.log("\n  UpSkiller Desktop Crawler");
  console.log("  ========================\n");
  console.log("  This will open your Chrome browser and crawl your logged-in apps.");
  console.log("  Your existing sessions and cookies will be used (read-only).\n");

  // Find Chrome
  const chromePath = findChrome();
  if (!chromePath) {
    console.error("  ERROR: Google Chrome not found. Install Chrome and try again.");
    process.exit(1);
  }
  console.log(`  Chrome: ${chromePath}`);

  // Find Chrome profile
  const profilePath = CHROME_PROFILE_PATHS[process.platform] || "";
  if (!fs.existsSync(profilePath)) {
    console.error(`  ERROR: Chrome profile not found at ${profilePath}`);
    process.exit(1);
  }
  console.log(`  Profile: ${profilePath}\n`);

  // Determine what to crawl
  let targets: { name: string; urls: string[]; pages?: AppConfig["pages"] }[] = [];

  if (urlsArg) {
    // Custom URLs
    const urls = urlsArg.split(",").map((u) => u.trim());
    targets = urls.map((url) => ({ name: new URL(url).hostname, urls: [url] }));
  } else if (appsArg) {
    // Specific apps
    const apps = appsArg.split(",").map((a) => a.trim().toLowerCase());
    for (const app of apps) {
      if (APP_CONFIGS[app]) {
        targets.push(APP_CONFIGS[app]);
      } else {
        console.log(`  WARNING: Unknown app "${app}". Skipping.`);
      }
    }
  } else {
    // Auto-discover: try all known apps
    console.log("  No apps specified. Will auto-discover which apps you're logged into.\n");
    targets = Object.values(APP_CONFIGS);
  }

  console.log(`  Crawling ${targets.length} app targets...\n`);

  // Launch browser with user's profile
  let browser: Browser;
  try {
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: false, // User can see what's happening
      args: [
        `--user-data-dir=${profilePath}`,
        "--profile-directory=Default",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
      ],
    });
  } catch (err) {
    console.error("\n  ERROR: Could not launch Chrome. Close any existing Chrome windows and try again.");
    console.error(`  Detail: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const context = browser.contexts()[0] || await browser.newContext();
  const allResults: CrawlResult[] = [];

  // Crawl each target
  for (const target of targets) {
    console.log(`\n  ─── ${target.name} ───`);
    const page = await context.newPage();

    try {
      // Navigate to the first URL
      const baseUrl = target.urls[0];
      console.log(`  Navigating to ${baseUrl}...`);
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(3000);

      // Check if we're logged in (not on a login page)
      const currentUrl = page.url();
      const title = await page.title();
      const isLoginPage = currentUrl.includes("login") || currentUrl.includes("signin") ||
        currentUrl.includes("auth") || title.toLowerCase().includes("sign in");

      if (isLoginPage) {
        console.log(`  SKIPPED: Not logged into ${target.name} (redirected to login)`);
        await page.close();
        continue;
      }

      console.log(`  CONNECTED: ${title}`);

      // Crawl the main page
      const mainResult = await extractPageData(page, target.name, "main");
      allResults.push(mainResult);
      console.log(`  Extracted ${mainResult.text.length} chars from main page`);

      // Crawl sub-pages if defined
      if (target.pages) {
        for (const subPage of target.pages) {
          try {
            const subUrl = subPage.path ? new URL(subPage.path, baseUrl).toString() : baseUrl;
            console.log(`  Crawling ${subPage.name}...`);
            await page.goto(subUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
            await page.waitForTimeout(subPage.waitFor || 3000);

            const result = await extractPageData(page, target.name, subPage.name);
            allResults.push(result);
            console.log(`  Extracted ${result.text.length} chars, ${result.tables.length} tables`);
          } catch (err) {
            console.log(`  WARNING: Could not crawl ${subPage.name}: ${err instanceof Error ? err.message.slice(0, 60) : "error"}`);
          }
        }
      }
    } catch (err) {
      console.log(`  ERROR: ${err instanceof Error ? err.message.slice(0, 80) : "Could not access"}`);
    }

    await page.close();
  }

  await browser.close();

  if (allResults.length === 0) {
    console.log("\n  No data collected. Make sure you're logged into your apps in Chrome.\n");
    process.exit(1);
  }

  // Save raw results
  fs.writeFileSync(outputArg, JSON.stringify(allResults, null, 2));
  console.log(`\n  Crawled ${allResults.length} pages across ${new Set(allResults.map((r) => r.app)).size} apps`);
  console.log(`  Raw data saved to ${outputArg}`);

  // Analyze with Opus
  console.log("\n  Running Opus 4.6 deep analysis...\n");
  const findings = await analyzeWithOpus(allResults);

  // Save findings
  const findingsPath = outputArg.replace(".json", "-findings.json");
  fs.writeFileSync(findingsPath, JSON.stringify(findings, null, 2));
  console.log(`\n  Findings saved to ${findingsPath}`);

  // Print summary
  if (findings.summary) {
    console.log(`\n  ════════════════════════════════════════`);
    console.log(`  TOTAL WASTE IDENTIFIED: ${findings.summary.totalAnnualWaste}`);
    console.log(`  FINDINGS: ${findings.summary.findingsCount}`);
    console.log(`  CRITICAL: ${findings.summary.criticalCount}`);
    console.log(`  ════════════════════════════════════════\n`);
  }

  if (findings.findings) {
    for (const f of findings.findings) {
      const severity = f.severity === "critical" ? "🔴" : f.severity === "high" ? "🟡" : "🔵";
      console.log(`  ${severity} ${f.title}${f.amount ? " — " + f.amount : ""}`);
      console.log(`     ${f.description.slice(0, 120)}...`);
      if (f.recommendation) console.log(`     → ${f.recommendation.slice(0, 120)}`);
      console.log();
    }
  }

  // Gap analysis
  if (findings.gaps) {
    console.log("\n  ─── DATA GAPS ───");
    console.log("  To unlock more findings, provide:\n");
    for (const gap of findings.gaps) {
      console.log(`  • ${gap.dataNeeded} — Expected value: ${gap.expectedValue || "unknown"}`);
      console.log(`    ${gap.reason}`);
    }
  }

  console.log("\n  To view findings in the Command Center:");
  console.log(`  Open: https://upskiller-scanner.vercel.app/results?file=${encodeURIComponent(findingsPath)}\n`);
}

// ─── HELPERS ───

function findChrome(): string | null {
  const paths = CHROME_PATHS[process.platform] || [];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function extractPageData(page: Page, appName: string, pageName: string): Promise<CrawlResult> {
  const url = page.url();
  const title = await page.title();

  // Extract all visible text
  const text = await page.evaluate(() => {
    // Remove scripts, styles, hidden elements
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, style, noscript, [aria-hidden='true'], [style*='display: none'], [style*='display:none']").forEach((el) => el.remove());
    return clone.innerText.slice(0, 100000); // Cap at 100K chars per page
  });

  // Extract all tables
  const tables = await page.evaluate(() => {
    const allTables: string[][] = [];
    document.querySelectorAll("table").forEach((table) => {
      const rows: string[] = [];
      table.querySelectorAll("tr").forEach((tr) => {
        const cells: string[] = [];
        tr.querySelectorAll("td, th").forEach((cell) => {
          cells.push((cell as HTMLElement).innerText.trim());
        });
        if (cells.length > 0) rows.push(cells.join(" | "));
      });
      if (rows.length > 0) allTables.push(rows);
    });
    return allTables.slice(0, 20); // Max 20 tables per page
  });

  // Extract key metrics (numbers with $ or % signs)
  const metrics = await page.evaluate(() => {
    const text = document.body.innerText;
    const dollarMatches = text.match(/\$[\d,]+(?:\.\d{2})?(?:K|M|B)?/g) || [];
    const percentMatches = text.match(/\d+(?:\.\d+)?%/g) || [];
    return [...new Set([...dollarMatches, ...percentMatches])].slice(0, 50);
  });

  return {
    app: appName,
    page: pageName,
    url,
    title,
    text: text + (metrics.length > 0 ? "\n\nKEY METRICS FOUND: " + metrics.join(", ") : ""),
    tables,
    timestamp: new Date().toISOString(),
  };
}

async function analyzeWithOpus(results: CrawlResult[]): Promise<{
  summary?: { totalAnnualWaste: string; findingsCount: number; criticalCount: number };
  findings?: Array<{
    title: string; description: string; amount: string | null;
    severity: string; category: string; agent: string;
    department: string; recommendation: string; evidence: string;
    timeToValue: string;
  }>;
  gaps?: Array<{ dataNeeded: string; reason: string; expectedValue: string }>;
}> {
  const appsFound = [...new Set(results.map((r) => r.app))];
  const dataByApp = results.map((r) => {
    const tableText = r.tables.map((t) => t.join("\n")).join("\n---\n");
    return `=== ${r.app} / ${r.page} ===\nURL: ${r.url}\nTitle: ${r.title}\n${r.text.slice(0, 50000)}\n${tableText ? "TABLES:\n" + tableText.slice(0, 20000) : ""}`;
  }).join("\n\n");

  const prompt = `You are UpSkiller AI's Atlas agent. You have just completed a desktop crawl of a company's live systems. The crawler visited their actual apps while logged in and extracted all visible data.

## SYSTEMS CRAWLED
Apps accessed: ${appsFound.join(", ")}
Pages crawled: ${results.length}
Total data extracted: ${dataByApp.length} characters

## RAW DATA FROM CRAWL

${dataByApp.slice(0, 500000)}

## ANALYSIS INSTRUCTIONS

Analyze ALL data across ALL systems to produce a complete operational assessment.

Run these analysis passes:
1. CROSS-SYSTEM CORRELATION: Find patterns that only appear when looking at multiple systems together. Vendor in Slack AND QuickBooks? Software mentioned in email AND billing?
2. SPEND ANALYSIS: Every dollar amount you find, categorize and flag anomalies.
3. VENDOR INTELLIGENCE: Map all vendors, contracts, subscriptions visible in the data.
4. LICENSE & SUBSCRIPTION WASTE: Identify tools, seats, subscriptions that appear unused or redundant.
5. OPERATIONAL PATTERNS: Meeting overhead, communication patterns, process bottlenecks.
6. COMPLIANCE & RISK: Access control issues, audit gaps, regulatory exposure.
7. KNOWLEDGE RISK: Key person dependencies visible in the data.

## OUTPUT FORMAT

{
  "summary": {
    "totalAnnualWaste": "$X.XM",
    "findingsCount": N,
    "criticalCount": N,
    "systemsCrawled": [${appsFound.map((a) => `"${a}"`).join(", ")}],
    "topRiskArea": "one sentence"
  },
  "findings": [
    {
      "title": "Short headline under 80 chars",
      "description": "2-3 sentences with SPECIFIC data. Reference actual vendor names, dollar amounts, user names, dates from the crawled data.",
      "amount": "$XXK or null",
      "severity": "critical | high | medium",
      "category": "Duplicates | Procurement | Licensing | Compliance | Operations | Risk | Knowledge | Pricing",
      "department": "inferred department",
      "agent": "Ledger | Quartermaster | Chief | Scout | Signal | Atlas",
      "recommendation": "SPECIFIC action with names and dates",
      "evidence": "exact data points from the crawl",
      "timeToValue": "immediate | 30 days | 90 days | 6 months"
    }
  ],
  "gaps": [
    {
      "dataNeeded": "What specific data/system access would unlock more findings",
      "reason": "Why this data matters",
      "expectedValue": "Estimated dollar impact of filling this gap"
    }
  ]
}

RULES:
- Find 15-25 findings. Be exhaustive.
- Every finding references SPECIFIC data from the crawl
- The "gaps" section is critical: identify what WASN'T crawled that would reveal more waste
- Estimate dollar amounts using industry benchmarks where direct amounts aren't visible
- Cross-reference across systems: a finding that connects Slack data with QuickBooks data is worth more than a finding from one system alone

Respond ONLY with the JSON object.`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: "claude-opus-4-20250514",
        max_tokens: 16384,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content[0];
      if (content.type === "text") {
        let text = content.text.trim();
        if (text.startsWith("```")) text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        return JSON.parse(text);
      }
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 529 && attempt < 2) {
        console.log("  High demand — retrying...");
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      console.error(`  Analysis error: ${err instanceof Error ? err.message : "unknown"}`);
      return {};
    }
  }
  return {};
}

main().catch((err) => {
  console.error("\n  Fatal error:", err.message);
  process.exit(1);
});
