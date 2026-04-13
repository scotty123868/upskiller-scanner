#!/usr/bin/env npx tsx
/**
 * UpSkiller Agentic Crawler
 *
 * Phase 1: Discovery — reads Chrome history, cookies, bookmarks, and local
 *          filesystem to discover every app, tool, and data source.
 * Phase 2: Web Crawl — launches Chrome with user's profile, crawls every
 *          discovered app they're logged into.
 * Phase 3: Desktop Scan — scans local filesystem for financial docs, exports,
 *          config files, and native app data.
 * Phase 4: Analysis — sends everything to Opus 4.6 for cross-system analysis.
 * Phase 5: Gap Detection — maps findings to command center, identifies what's
 *          missing, tells user exactly what to provide next.
 *
 * Usage:
 *   npx tsx src/crawler/crawl.ts              # full auto-discovery + crawl
 *   npx tsx src/crawler/crawl.ts --web-only   # skip desktop scan
 *   npx tsx src/crawler/crawl.ts --discover   # discovery only, no crawl
 */

import { chromium, type Browser, type Page } from "playwright-core";
import Anthropic from "@anthropic-ai/sdk";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import * as readline from "readline";

const anthropic = new Anthropic();

// ─── TYPES ───

type DiscoveredApp = {
  domain: string;
  name: string;
  category: "saas" | "erp" | "finance" | "hr" | "communication" | "storage" | "other";
  visitCount: number;
  lastVisit: string;
  hasActiveSession: boolean;
  source: "history" | "cookies" | "bookmarks" | "filesystem";
};

type CrawlResult = {
  app: string;
  page: string;
  url: string;
  title: string;
  text: string;
  tables: string[][];
  metrics: string[];
  timestamp: string;
  source: "browser" | "desktop" | "filesystem";
};

type GapItem = {
  section: string;
  status: "populated" | "partial" | "empty";
  coverage: number;
  dataNeeded: string;
  howToProvide: string;
  expectedValue: string;
};

// ─── CHROME PATHS ───

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

// Known SaaS domains → categories
const KNOWN_APPS: Record<string, { name: string; category: DiscoveredApp["category"]; pages?: string[] }> = {
  "app.slack.com": { name: "Slack", category: "communication", pages: ["/client"] },
  "slack.com": { name: "Slack", category: "communication" },
  "qbo.intuit.com": { name: "QuickBooks", category: "finance", pages: ["/app/homepage", "/app/expenses", "/app/vendorlist", "/app/reportv2?token=ProfitAndLoss"] },
  "c1.qbo.intuit.com": { name: "QuickBooks", category: "finance" },
  "books.zoho.com": { name: "Zoho Books", category: "finance" },
  "go.xero.com": { name: "Xero", category: "finance", pages: ["/Dashboard", "/AccountsPayable/Dashboard", "/Contacts/Search"] },
  "system.netsuite.com": { name: "NetSuite", category: "erp", pages: ["/app/center/card.nl", "/app/common/entity/vendorlist.nl"] },
  "app.hubspot.com": { name: "HubSpot", category: "saas", pages: ["/reports-dashboard", "/contacts"] },
  "login.salesforce.com": { name: "Salesforce", category: "saas" },
  "admin.google.com": { name: "Google Admin", category: "saas", pages: ["/", "/ac/users", "/ac/billing/subscriptions"] },
  "mail.google.com": { name: "Gmail", category: "communication" },
  "drive.google.com": { name: "Google Drive", category: "storage" },
  "calendar.google.com": { name: "Google Calendar", category: "saas" },
  "app.asana.com": { name: "Asana", category: "saas" },
  "trello.com": { name: "Trello", category: "saas" },
  "linear.app": { name: "Linear", category: "saas" },
  "notion.so": { name: "Notion", category: "saas" },
  "airtable.com": { name: "Airtable", category: "saas" },
  "app.datadog.com": { name: "Datadog", category: "saas" },
  "dashboard.stripe.com": { name: "Stripe", category: "finance" },
  "app.bill.com": { name: "Bill.com", category: "finance" },
  "app.ramp.com": { name: "Ramp", category: "finance" },
  "app.brex.com": { name: "Brex", category: "finance" },
  "app.expensify.com": { name: "Expensify", category: "finance" },
  "console.aws.amazon.com": { name: "AWS", category: "saas" },
  "portal.azure.com": { name: "Azure", category: "saas" },
  "console.cloud.google.com": { name: "GCP", category: "saas" },
  "app.bamboohr.com": { name: "BambooHR", category: "hr" },
  "app.gusto.com": { name: "Gusto", category: "hr" },
  "app.rippling.com": { name: "Rippling", category: "hr" },
  "my.adp.com": { name: "ADP", category: "hr" },
  "one.newrelic.com": { name: "New Relic", category: "saas" },
  "app.pagerduty.com": { name: "PagerDuty", category: "saas" },
  "zoom.us": { name: "Zoom", category: "communication" },
  "teams.microsoft.com": { name: "Microsoft Teams", category: "communication" },
  "outlook.office.com": { name: "Outlook", category: "communication" },
  "github.com": { name: "GitHub", category: "saas" },
  "gitlab.com": { name: "GitLab", category: "saas" },
  "figma.com": { name: "Figma", category: "saas" },
  "vercel.com": { name: "Vercel", category: "saas" },
  "app.netlify.com": { name: "Netlify", category: "saas" },
  "1password.com": { name: "1Password", category: "saas" },
  "app.lastpass.com": { name: "LastPass", category: "saas" },
  "dropbox.com": { name: "Dropbox", category: "storage" },
  "box.com": { name: "Box", category: "storage" },
};

// ─── PHASE 1: DISCOVERY ───

async function discoverApps(): Promise<DiscoveredApp[]> {
  console.log("\n  PHASE 1: DISCOVERY");
  console.log("  ──────────────────\n");

  const discovered = new Map<string, DiscoveredApp>();

  // 1a. Chrome History (SQLite)
  console.log("  Scanning Chrome browsing history...");
  const historyApps = await readChromeHistory();
  for (const app of historyApps) {
    const existing = discovered.get(app.domain);
    if (!existing || app.visitCount > existing.visitCount) {
      discovered.set(app.domain, app);
    }
  }
  console.log(`    Found ${historyApps.length} unique app domains from history`);

  // 1b. Chrome Cookies (active sessions)
  console.log("  Scanning Chrome cookies for active sessions...");
  const cookieDomains = await readChromeCookies();
  for (const domain of cookieDomains) {
    const existing = discovered.get(domain);
    if (existing) {
      existing.hasActiveSession = true;
    } else {
      const known = findKnownApp(domain);
      if (known) {
        discovered.set(domain, {
          domain,
          name: known.name,
          category: known.category,
          visitCount: 0,
          lastVisit: "",
          hasActiveSession: true,
          source: "cookies",
        });
      }
    }
  }
  console.log(`    Found ${cookieDomains.length} domains with active cookies`);

  // 1c. Filesystem scan for financial documents
  console.log("  Scanning filesystem for financial documents...");
  const fileDocs = await scanFilesystem();
  console.log(`    Found ${fileDocs.length} financial/business documents`);

  // 1d. Native app detection (macOS)
  if (process.platform === "darwin") {
    console.log("  Detecting installed desktop apps...");
    const nativeApps = detectNativeApps();
    console.log(`    Found ${nativeApps.length} relevant native apps`);
  }

  const apps = [...discovered.values()];
  const withSession = apps.filter((a) => a.hasActiveSession);

  console.log(`\n  DISCOVERY COMPLETE:`);
  console.log(`    ${apps.length} total apps/services detected`);
  console.log(`    ${withSession.length} with active sessions (can crawl)`);
  console.log(`    ${fileDocs.length} local documents found\n`);

  // Show what was found
  const byCategory = new Map<string, DiscoveredApp[]>();
  for (const app of apps.sort((a, b) => b.visitCount - a.visitCount)) {
    const cat = app.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(app);
  }

  for (const [cat, catApps] of byCategory) {
    console.log(`    ${cat.toUpperCase()}: ${catApps.map((a) => `${a.name}${a.hasActiveSession ? " *" : ""}`).join(", ")}`);
  }
  console.log(`\n    (* = active session, will be crawled)`);

  return apps;
}

async function readChromeHistory(): Promise<DiscoveredApp[]> {
  const profilePath = CHROME_PROFILE_PATHS[process.platform];
  const historyPath = path.join(profilePath, "Default", "History");

  if (!fs.existsSync(historyPath)) return [];

  // Copy the DB because Chrome locks it
  const tmpPath = `/tmp/upskiller-chrome-history-${Date.now()}`;
  try {
    fs.copyFileSync(historyPath, tmpPath);
    // Use sqlite3 CLI to read (available on macOS by default)
    const result = execSync(
      `sqlite3 "${tmpPath}" "SELECT url, visit_count, datetime(last_visit_time/1000000-11644473600, 'unixepoch') as last_visit FROM urls WHERE visit_count > 2 ORDER BY visit_count DESC LIMIT 500"`,
      { encoding: "utf-8", timeout: 5000 }
    );

    const apps: DiscoveredApp[] = [];
    const seen = new Set<string>();

    for (const line of result.split("\n")) {
      if (!line.trim()) continue;
      const [url, countStr, lastVisit] = line.split("|");
      try {
        const hostname = new URL(url).hostname;
        // Strip www prefix
        const domain = hostname.replace(/^www\./, "");
        if (seen.has(domain)) continue;
        seen.add(domain);

        const known = findKnownApp(domain);
        if (known) {
          apps.push({
            domain,
            name: known.name,
            category: known.category,
            visitCount: parseInt(countStr) || 0,
            lastVisit: lastVisit || "",
            hasActiveSession: false,
            source: "history",
          });
        }
      } catch { /* skip invalid URLs */ }
    }

    return apps;
  } catch {
    return [];
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ok */ }
  }
}

async function readChromeCookies(): Promise<string[]> {
  const profilePath = CHROME_PROFILE_PATHS[process.platform];
  const cookiesPath = path.join(profilePath, "Default", "Cookies");

  if (!fs.existsSync(cookiesPath)) return [];

  const tmpPath = `/tmp/upskiller-chrome-cookies-${Date.now()}`;
  try {
    fs.copyFileSync(cookiesPath, tmpPath);
    const result = execSync(
      `sqlite3 "${tmpPath}" "SELECT DISTINCT host_key FROM cookies WHERE datetime(expires_utc/1000000-11644473600, 'unixepoch') > datetime('now') LIMIT 500"`,
      { encoding: "utf-8", timeout: 5000 }
    );

    const domains: string[] = [];
    for (const line of result.split("\n")) {
      const domain = line.trim().replace(/^\./, "");
      if (domain && KNOWN_APPS[domain]) {
        domains.push(domain);
      }
    }
    return [...new Set(domains)];
  } catch {
    return [];
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ok */ }
  }
}

async function scanFilesystem(): Promise<{ path: string; name: string; size: number; type: string }[]> {
  const home = os.homedir();
  const searchDirs = [
    path.join(home, "Desktop"),
    path.join(home, "Documents"),
    path.join(home, "Downloads"),
  ];

  const patterns = [
    { ext: ".csv", type: "spreadsheet" },
    { ext: ".xlsx", type: "spreadsheet" },
    { ext: ".xls", type: "spreadsheet" },
    { ext: ".pdf", type: "document" },
  ];

  const keywords = ["invoice", "vendor", "contract", "budget", "expense", "payment", "receipt",
    "purchase", "order", "renewal", "subscription", "license", "quote", "proposal",
    "agreement", "sow", "aging", "ap ", "ar ", "payroll", "equipment", "fleet", "asset"];

  const found: { path: string; name: string; size: number; type: string }[] = [];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      // Use find command for speed (max depth 3 to avoid going too deep)
      const result = execSync(
        `find "${dir}" -maxdepth 3 \\( -name "*.csv" -o -name "*.xlsx" -o -name "*.xls" -o -name "*.pdf" \\) -type f 2>/dev/null | head -200`,
        { encoding: "utf-8", timeout: 10000 }
      );

      for (const filePath of result.split("\n")) {
        if (!filePath.trim()) continue;
        const fileName = path.basename(filePath).toLowerCase();
        const matchesKeyword = keywords.some((k) => fileName.includes(k));
        if (matchesKeyword) {
          try {
            const stat = fs.statSync(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const type = patterns.find((p) => p.ext === ext)?.type || "other";
            found.push({ path: filePath, name: path.basename(filePath), size: stat.size, type });
          } catch { /* skip inaccessible */ }
        }
      }
    } catch { /* skip errors */ }
  }

  return found.slice(0, 50); // Cap at 50 files
}

function detectNativeApps(): string[] {
  if (process.platform !== "darwin") return [];
  try {
    const result = execSync(
      `ls /Applications/ | grep -iE "(slack|excel|word|quickbooks|teams|outlook|zoom|notion|1password)" 2>/dev/null`,
      { encoding: "utf-8", timeout: 3000 }
    );
    return result.split("\n").filter((l) => l.trim());
  } catch {
    return [];
  }
}

function findKnownApp(domain: string): { name: string; category: DiscoveredApp["category"]; pages?: string[] } | null {
  if (KNOWN_APPS[domain]) return KNOWN_APPS[domain];
  // Check parent domains (e.g., sub.slack.com → slack.com)
  const parts = domain.split(".");
  if (parts.length > 2) {
    const parent = parts.slice(-2).join(".");
    if (KNOWN_APPS[parent]) return KNOWN_APPS[parent];
  }
  return null;
}

// ─── PHASE 2: WEB CRAWL ───

async function crawlWeb(apps: DiscoveredApp[]): Promise<CrawlResult[]> {
  console.log("\n  PHASE 2: WEB CRAWL");
  console.log("  ──────────────────\n");

  const crawlable = apps.filter((a) => a.hasActiveSession);
  if (crawlable.length === 0) {
    console.log("  No apps with active sessions found. Skipping web crawl.");
    console.log("  (Log into your apps in Chrome first, then re-run)\n");
    return [];
  }

  console.log(`  Crawling ${crawlable.length} apps with active sessions...\n`);

  const chromePath = findChrome();
  if (!chromePath) {
    console.log("  ERROR: Chrome not found. Skipping web crawl.");
    return [];
  }

  const profilePath = CHROME_PROFILE_PATHS[process.platform];
  let browser: Browser;
  try {
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: false,
      args: [
        `--user-data-dir=${profilePath}`,
        "--profile-directory=Default",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
      ],
    });
  } catch {
    console.log("  ERROR: Could not launch Chrome. Close existing Chrome windows and retry.");
    return [];
  }

  const context = browser.contexts()[0] || await browser.newContext();
  const results: CrawlResult[] = [];

  for (const app of crawlable) {
    console.log(`  ─── ${app.name} (${app.domain}) ───`);
    const page = await context.newPage();

    try {
      const baseUrl = `https://${app.domain}`;
      const known = KNOWN_APPS[app.domain];

      // Navigate to base URL
      console.log(`    Opening ${baseUrl}...`);
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(3000);

      // Check login status
      const currentUrl = page.url();
      if (currentUrl.includes("login") || currentUrl.includes("signin") || currentUrl.includes("/auth")) {
        console.log(`    SKIPPED: Not logged in (redirected to auth)`);
        await page.close();
        continue;
      }

      console.log(`    CONNECTED: ${await page.title()}`);
      const mainResult = await extractPageData(page, app.name, "main");
      results.push(mainResult);

      // Crawl sub-pages
      if (known?.pages) {
        for (const subPath of known.pages) {
          try {
            const subUrl = new URL(subPath, baseUrl).toString();
            console.log(`    Crawling ${subPath}...`);
            await page.goto(subUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
            await page.waitForTimeout(3000);
            const result = await extractPageData(page, app.name, subPath);
            results.push(result);
            console.log(`      ${result.text.length} chars, ${result.tables.length} tables, ${result.metrics.length} metrics`);
          } catch {
            console.log(`      Could not crawl ${subPath}`);
          }
        }
      }
    } catch (err) {
      console.log(`    ERROR: ${err instanceof Error ? err.message.slice(0, 60) : "failed"}`);
    }

    await page.close();
  }

  await browser.close();
  console.log(`\n  Web crawl complete: ${results.length} pages across ${crawlable.length} apps\n`);
  return results;
}

// ─── PHASE 3: DESKTOP SCAN ───

async function scanDesktop(): Promise<CrawlResult[]> {
  console.log("\n  PHASE 3: DESKTOP SCAN");
  console.log("  ─────────────────────\n");

  const results: CrawlResult[] = [];

  // 3a. Read financial spreadsheets from filesystem
  console.log("  Scanning for spreadsheets and financial documents...");
  const docs = await scanFilesystem();

  for (const doc of docs.slice(0, 10)) { // Process top 10 most relevant files
    if (doc.type === "spreadsheet" && doc.size < 10 * 1024 * 1024) { // Under 10MB
      try {
        const content = readSpreadsheet(doc.path);
        if (content) {
          results.push({
            app: "Local Files",
            page: doc.name,
            url: doc.path,
            title: doc.name,
            text: content.slice(0, 100000),
            tables: [],
            metrics: extractDollarAmounts(content),
            timestamp: new Date().toISOString(),
            source: "filesystem",
          });
          console.log(`    Read: ${doc.name} (${(doc.size / 1024).toFixed(0)}KB)`);
        }
      } catch { /* skip unreadable */ }
    }
  }

  // 3b. Check for Slack desktop app exports
  const slackDir = path.join(os.homedir(), "Library/Application Support/Slack");
  if (fs.existsSync(slackDir)) {
    console.log("  Slack desktop app detected (data in app, would need API access)");
  }

  // 3c. Check for common data export directories
  const exportDirs = [
    path.join(os.homedir(), "Downloads"),
    path.join(os.homedir(), "Documents/Exports"),
    path.join(os.homedir(), "Documents/Reports"),
  ];
  for (const dir of exportDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir).filter((f) =>
        /\.(csv|xlsx)$/i.test(f) &&
        fs.statSync(path.join(dir, f)).mtime > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // Last 90 days
      );
      if (files.length > 0) {
        console.log(`    Found ${files.length} recent data exports in ${dir}`);
      }
    } catch { /* skip */ }
  }

  console.log(`\n  Desktop scan complete: ${results.length} local files analyzed\n`);
  return results;
}

function readSpreadsheet(filePath: string): string | null {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".csv") {
      return fs.readFileSync(filePath, "utf-8").slice(0, 100000);
    }
    // For xlsx, we'd need the xlsx library — import dynamically
    // For now, just note the file exists
    return `[Excel file: ${path.basename(filePath)}, size: ${fs.statSync(filePath).size} bytes]`;
  } catch {
    return null;
  }
}

function extractDollarAmounts(text: string): string[] {
  const matches = text.match(/\$[\d,]+(?:\.\d{2})?(?:K|M|B)?/g) || [];
  return [...new Set(matches)].slice(0, 50);
}

// ─── PHASE 4: OPUS ANALYSIS ───

async function analyzeAll(webResults: CrawlResult[], desktopResults: CrawlResult[], discoveredApps: DiscoveredApp[]) {
  console.log("\n  PHASE 4: OPUS 4.6 DEEP ANALYSIS");
  console.log("  ────────────────────────────────\n");

  const allResults = [...webResults, ...desktopResults];

  if (allResults.length === 0) {
    console.log("  No data to analyze. Make sure you're logged into apps in Chrome.\n");
    return null;
  }

  const appsSummary = discoveredApps
    .filter((a) => a.hasActiveSession)
    .map((a) => `${a.name} (${a.category}, ${a.visitCount} visits)`)
    .join(", ");

  const allApps = discoveredApps.map((a) => `${a.name} (${a.category}${a.hasActiveSession ? ", CRAWLED" : ", detected but not crawled"})`).join(", ");

  const dataBySource = allResults.map((r) => {
    const tableText = r.tables.map((t) => t.join("\n")).join("\n---\n");
    return `=== ${r.app} / ${r.page} [${r.source}] ===\nURL: ${r.url}\nTitle: ${r.title}\nMetrics: ${r.metrics.join(", ")}\n${r.text.slice(0, 40000)}\n${tableText ? "TABLES:\n" + tableText.slice(0, 15000) : ""}`;
  }).join("\n\n");

  console.log(`  Sending ${allResults.length} pages to Opus 4.6...`);
  console.log(`  Apps crawled: ${appsSummary}`);
  console.log(`  Total data: ${(dataBySource.length / 1024).toFixed(0)}KB\n`);

  const prompt = `You are UpSkiller AI's Atlas agent running a FULL AGENTIC CRAWL of an organization.

## WHAT WAS DISCOVERED

All apps/services detected on this machine: ${allApps}

Apps with active sessions (crawled): ${appsSummary}

Total pages crawled: ${allResults.length}
Sources: ${[...new Set(allResults.map((r) => r.source))].join(", ")}

## RAW CRAWL DATA

${dataBySource.slice(0, 500000)}

## ANALYSIS INSTRUCTIONS

You have access to the ACTUAL live data from this organization's systems. This is not sample data. These are real vendor names, real dollar amounts, real employees, real contracts.

Run a COMPLETE operational assessment:

1. CROSS-SYSTEM CORRELATION: What patterns emerge when you look at data from multiple apps together?
2. VENDOR INTELLIGENCE: Map every vendor, contract, and subscription you can see. Flag duplicates, overcharges, upcoming renewals.
3. SPEND ANALYSIS: Every dollar amount, categorize it. Find anomalies, duplicates, trends.
4. LICENSE & SUBSCRIPTION WASTE: Tools visible in the crawl that appear unused or redundant.
5. OPERATIONAL EFFICIENCY: Meeting patterns, communication overhead, process bottlenecks.
6. COMPLIANCE & RISK: Access control issues, documentation gaps, regulatory exposure.
7. KNOWLEDGE RISK: Key person dependencies, tribal knowledge, succession gaps.

## COMMAND CENTER MAPPING

Map your findings to these Command Center sections:
- Annualized Savings (total dollar impact)
- Division Breakdown (Claims Ops, Supply Chain, Clinical Services, Vendor Management, Underwriting — or infer departments from the data)
- Operational Health per division (Clear / Watch / Act)
- Active Findings with evidence
- Knowledge Captured (decision patterns found)

## OUTPUT FORMAT

{
  "summary": {
    "totalAnnualWaste": "$X.XM",
    "findingsCount": N,
    "criticalCount": N,
    "systemsCrawled": [list],
    "systemsDetectedNotCrawled": [list],
    "topRiskArea": "one sentence",
    "coverageScore": N (0-100, what % of a full assessment we achieved)
  },
  "findings": [
    {
      "title": "Under 80 chars",
      "description": "2-3 sentences with REAL data from the crawl. Actual vendor names, dollar amounts, user names.",
      "amount": "$XXK or null",
      "severity": "critical | high | medium",
      "category": "Duplicates | Procurement | Licensing | Compliance | Operations | Risk | Knowledge | Pricing",
      "department": "inferred department",
      "agent": "Ledger | Quartermaster | Chief | Scout | Signal | Atlas",
      "recommendation": "SPECIFIC action: 'Cancel the $X/month subscription to Y by contacting Z'",
      "evidence": "exact data from the crawl",
      "timeToValue": "immediate | 30 days | 90 days | 6 months"
    }
  ],
  "commandCenter": {
    "annualizedSavings": "$X.XM",
    "divisions": [
      { "name": "dept name", "savings": "$XXK", "status": "Clear|Watch|Act", "findings": N }
    ],
    "agentStatus": [
      { "agent": "Ledger", "status": "active", "findings": N },
      { "agent": "Quartermaster", "status": "active", "findings": N }
    ]
  },
  "gaps": [
    {
      "section": "Command Center section name",
      "status": "populated | partial | empty",
      "coverage": N,
      "dataNeeded": "What specific data/system access would fill this gap",
      "howToProvide": "Upload a CSV export from QuickBooks: File → Reports → Expense by Vendor → Export",
      "expectedValue": "Estimated additional waste this would reveal"
    }
  ]
}

Be exhaustive. Find 15-25 findings. The gaps section is CRITICAL — it tells the user exactly what to do next to unlock more value.

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
      return null;
    }
  }
  return null;
}

// ─── PHASE 5: GAP REPORT ───

function printGapReport(analysis: { gaps?: GapItem[]; summary?: { coverageScore?: number } }) {
  console.log("\n  PHASE 5: GAP ANALYSIS");
  console.log("  ─────────────────────\n");

  const coverage = analysis.summary?.coverageScore || 0;
  const bar = "█".repeat(Math.round(coverage / 5)) + "░".repeat(20 - Math.round(coverage / 5));
  console.log(`  Data Coverage: [${bar}] ${coverage}%\n`);

  if (!analysis.gaps || analysis.gaps.length === 0) {
    console.log("  No gaps identified. Full coverage achieved.");
    return;
  }

  console.log("  TO UNLOCK MORE FINDINGS:\n");
  for (let i = 0; i < analysis.gaps.length; i++) {
    const gap = analysis.gaps[i];
    const statusIcon = gap.status === "populated" ? "✓" : gap.status === "partial" ? "◐" : "○";
    console.log(`  ${i + 1}. ${statusIcon} ${gap.section} (${gap.coverage}% complete)`);
    console.log(`     Need: ${gap.dataNeeded}`);
    console.log(`     How:  ${gap.howToProvide}`);
    if (gap.expectedValue) console.log(`     Expected value: ${gap.expectedValue}`);
    console.log();
  }
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

  const text = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, style, noscript, [aria-hidden='true']").forEach((el) => el.remove());
    return clone.innerText.slice(0, 100000);
  });

  const tables = await page.evaluate(() => {
    const allTables: string[][] = [];
    document.querySelectorAll("table").forEach((table) => {
      const rows: string[] = [];
      table.querySelectorAll("tr").forEach((tr) => {
        const cells: string[] = [];
        tr.querySelectorAll("td, th").forEach((cell) => cells.push((cell as HTMLElement).innerText.trim()));
        if (cells.length > 0) rows.push(cells.join(" | "));
      });
      if (rows.length > 0) allTables.push(rows);
    });
    return allTables.slice(0, 20);
  });

  const metrics = await page.evaluate(() => {
    const text = document.body.innerText;
    const dollars = text.match(/\$[\d,]+(?:\.\d{2})?(?:K|M|B)?/g) || [];
    const percents = text.match(/\d+(?:\.\d+)?%/g) || [];
    return [...new Set([...dollars, ...percents])].slice(0, 50);
  });

  return { app: appName, page: pageName, url, title, text, tables, metrics, timestamp: new Date().toISOString(), source: "browser" };
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

// ─── MAIN ───

async function main() {
  const args = process.argv.slice(2);
  const webOnly = args.includes("--web-only");
  const discoverOnly = args.includes("--discover");

  console.log("\n  ╔═══════════════════════════════════════╗");
  console.log("  ║   UpSkiller Agentic Crawler           ║");
  console.log("  ║   Full system discovery + analysis    ║");
  console.log("  ╚═══════════════════════════════════════╝\n");
  console.log("  This agent will:");
  console.log("    1. Discover every app you use (Chrome history + cookies)");
  console.log("    2. Crawl apps you're logged into (opens Chrome)");
  if (!webOnly) console.log("    3. Scan local files for financial documents");
  console.log("    4. Analyze everything with Opus 4.6");
  console.log("    5. Map to Command Center + identify gaps\n");

  const answer = await prompt("  Ready? (y/n): ");
  if (answer.toLowerCase() !== "y") {
    console.log("  Aborted.\n");
    process.exit(0);
  }

  // Phase 1: Discovery
  const apps = await discoverApps();

  if (discoverOnly) {
    console.log("\n  Discovery-only mode. Exiting.\n");
    process.exit(0);
  }

  // Phase 2: Web Crawl
  const webResults = await crawlWeb(apps);

  // Phase 3: Desktop Scan
  let desktopResults: CrawlResult[] = [];
  if (!webOnly) {
    desktopResults = await scanDesktop();
  }

  // Save raw data
  const outputPath = `/tmp/upskiller-crawl-${Date.now()}.json`;
  const rawData = { apps, webResults, desktopResults, timestamp: new Date().toISOString() };
  fs.writeFileSync(outputPath, JSON.stringify(rawData, null, 2));
  console.log(`  Raw crawl data saved to ${outputPath}`);

  // Phase 4: Analysis
  const analysis = await analyzeAll(webResults, desktopResults, apps);

  if (!analysis) {
    console.log("\n  Analysis failed. Raw data saved — you can re-run analysis later.\n");
    process.exit(1);
  }

  // Save findings
  const findingsPath = `/tmp/upskiller-findings-${Date.now()}.json`;
  fs.writeFileSync(findingsPath, JSON.stringify(analysis, null, 2));

  // Print results
  if (analysis.summary) {
    console.log("\n  ════════════════════════════════════════");
    console.log(`  TOTAL WASTE IDENTIFIED: ${analysis.summary.totalAnnualWaste}`);
    console.log(`  FINDINGS: ${analysis.summary.findingsCount}`);
    console.log(`  CRITICAL: ${analysis.summary.criticalCount}`);
    console.log(`  COVERAGE: ${analysis.summary.coverageScore || 0}%`);
    console.log("  ════════════════════════════════════════\n");
  }

  if (analysis.findings) {
    for (const f of analysis.findings) {
      const sev = f.severity === "critical" ? "CRIT" : f.severity === "high" ? "HIGH" : "MED ";
      console.log(`  [${sev}] ${f.title}${f.amount ? " — " + f.amount : ""}`);
      console.log(`         ${f.description.slice(0, 120)}`);
      if (f.recommendation) console.log(`         → ${f.recommendation.slice(0, 120)}`);
      console.log();
    }
  }

  // Phase 5: Gap Analysis
  printGapReport(analysis);

  console.log(`\n  Findings saved to ${findingsPath}`);
  console.log(`  Raw data saved to ${outputPath}`);
  console.log("\n  Next: Upload these findings to the Command Center");
  console.log(`  Or provide the data listed above to fill the gaps.\n`);
}

main().catch((err) => {
  console.error("\n  Fatal error:", err.message);
  process.exit(1);
});
