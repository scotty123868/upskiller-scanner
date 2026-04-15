/**
 * SaaS Pricing Intelligence Database
 *
 * 180+ tools with domain patterns, categories, and typical per-seat pricing.
 * Pricing is approximate (industry benchmarks, public pricing pages) and
 * used for estimation, not billing. "Low" = starter/basic tier, "mid" =
 * professional/business tier, "high" = enterprise tier.
 *
 * Sources: Public pricing pages, G2, Gartner, industry reports.
 */

export type SaaSApp = {
  name: string;
  domains: string[];
  category: string;
  subcategory?: string;
  pricingModel: "per-seat" | "flat" | "usage" | "tiered" | "custom";
  pricePerSeatMonth?: { low: number; mid: number; high: number };
  flatMonthly?: { low: number; mid: number; high: number };
  notes?: string;
};

export const SAAS_DATABASE: SaaSApp[] = [
  // ════════════════════════════════════════════
  // CRM & SALES
  // ════════════════════════════════════════════
  { name: "Salesforce", domains: ["salesforce.com", "force.com", "lightning.force.com"], category: "CRM", pricingModel: "per-seat", pricePerSeatMonth: { low: 25, mid: 80, high: 165 } },
  { name: "HubSpot", domains: ["hubspot.com", "app.hubspot.com", "api.hubspot.com"], category: "CRM", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 45, high: 120 } },
  { name: "Pipedrive", domains: ["pipedrive.com"], category: "CRM", pricingModel: "per-seat", pricePerSeatMonth: { low: 14, mid: 34, high: 99 } },
  { name: "Zoho CRM", domains: ["zoho.com", "zohocrm.com"], category: "CRM", pricingModel: "per-seat", pricePerSeatMonth: { low: 14, mid: 23, high: 52 } },
  { name: "Close", domains: ["close.com", "app.close.com"], category: "CRM", pricingModel: "per-seat", pricePerSeatMonth: { low: 29, mid: 99, high: 149 } },
  { name: "Freshsales", domains: ["freshworks.com", "freshsales.io"], category: "CRM", pricingModel: "per-seat", pricePerSeatMonth: { low: 15, mid: 39, high: 69 } },
  { name: "Monday CRM", domains: ["monday.com"], category: "CRM", pricingModel: "per-seat", pricePerSeatMonth: { low: 10, mid: 14, high: 24 } },
  { name: "Copper", domains: ["copper.com", "prosperworks.com"], category: "CRM", pricingModel: "per-seat", pricePerSeatMonth: { low: 23, mid: 49, high: 99 } },
  { name: "Outreach", domains: ["outreach.io"], category: "Sales Engagement", pricingModel: "per-seat", pricePerSeatMonth: { low: 100, mid: 130, high: 170 } },
  { name: "Salesloft", domains: ["salesloft.com"], category: "Sales Engagement", pricingModel: "per-seat", pricePerSeatMonth: { low: 75, mid: 125, high: 165 } },
  { name: "Gong", domains: ["gong.io"], category: "Revenue Intelligence", pricingModel: "per-seat", pricePerSeatMonth: { low: 100, mid: 150, high: 200 } },
  { name: "Apollo.io", domains: ["apollo.io"], category: "Sales Intelligence", pricingModel: "per-seat", pricePerSeatMonth: { low: 39, mid: 79, high: 119 } },
  { name: "ZoomInfo", domains: ["zoominfo.com"], category: "Sales Intelligence", pricingModel: "custom", pricePerSeatMonth: { low: 200, mid: 350, high: 500 } },
  { name: "LinkedIn Sales Navigator", domains: ["linkedin.com"], category: "Sales Intelligence", pricingModel: "per-seat", pricePerSeatMonth: { low: 80, mid: 125, high: 165 } },
  { name: "Clari", domains: ["clari.com"], category: "Revenue Intelligence", pricingModel: "per-seat", pricePerSeatMonth: { low: 50, mid: 80, high: 120 } },

  // ════════════════════════════════════════════
  // COMMUNICATION & COLLABORATION
  // ════════════════════════════════════════════
  { name: "Slack", domains: ["slack.com", "app.slack.com"], category: "Communication", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 8.75, high: 12.50 } },
  { name: "Microsoft Teams", domains: ["teams.microsoft.com", "microsoft.com"], category: "Communication", pricingModel: "per-seat", pricePerSeatMonth: { low: 4, mid: 12.50, high: 22 }, notes: "Part of M365 bundle" },
  { name: "Zoom", domains: ["zoom.us", "zoom.com"], category: "Communication", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 13.33, high: 21.99 } },
  { name: "Google Meet", domains: ["meet.google.com"], category: "Communication", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 12, high: 18 }, notes: "Part of Google Workspace" },
  { name: "Webex", domains: ["webex.com"], category: "Communication", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 13.50, high: 26 } },
  { name: "RingCentral", domains: ["ringcentral.com"], category: "Communication", pricingModel: "per-seat", pricePerSeatMonth: { low: 20, mid: 25, high: 35 } },
  { name: "Dialpad", domains: ["dialpad.com"], category: "Communication", pricingModel: "per-seat", pricePerSeatMonth: { low: 15, mid: 25, high: 35 } },
  { name: "Loom", domains: ["loom.com"], category: "Communication", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 12.50, high: 15 } },
  { name: "Calendly", domains: ["calendly.com"], category: "Scheduling", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 10, high: 16 } },
  { name: "Discord", domains: ["discord.com"], category: "Communication", pricingModel: "flat", flatMonthly: { low: 0, mid: 0, high: 10 } },

  // ════════════════════════════════════════════
  // PROJECT MANAGEMENT & PRODUCTIVITY
  // ════════════════════════════════════════════
  { name: "Asana", domains: ["asana.com", "app.asana.com"], category: "Project Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 10.99, high: 24.99 } },
  { name: "Jira", domains: ["atlassian.com", "atlassian.net", "jira.com"], category: "Project Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 7.75, high: 15.25 } },
  { name: "Linear", domains: ["linear.app"], category: "Project Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 8, high: 14 } },
  { name: "Trello", domains: ["trello.com"], category: "Project Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 5, high: 17.50 } },
  { name: "Monday.com", domains: ["monday.com"], category: "Project Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 10, high: 19 } },
  { name: "ClickUp", domains: ["clickup.com", "app.clickup.com"], category: "Project Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 7, high: 12 } },
  { name: "Notion", domains: ["notion.so", "notion.com"], category: "Knowledge Base", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 8, high: 15 } },
  { name: "Confluence", domains: ["atlassian.com", "atlassian.net"], category: "Knowledge Base", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 5.75, high: 11 } },
  { name: "Basecamp", domains: ["basecamp.com"], category: "Project Management", pricingModel: "flat", flatMonthly: { low: 15, mid: 299, high: 299 } },
  { name: "Wrike", domains: ["wrike.com"], category: "Project Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 9.80, high: 24.80 } },
  { name: "Smartsheet", domains: ["smartsheet.com"], category: "Project Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 7, mid: 25, high: 32 } },
  { name: "Airtable", domains: ["airtable.com"], category: "Database/Spreadsheet", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 20, high: 45 } },
  { name: "Coda", domains: ["coda.io"], category: "Knowledge Base", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 10, high: 30 } },
  { name: "Miro", domains: ["miro.com"], category: "Whiteboard", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 8, high: 16 } },
  { name: "Figma", domains: ["figma.com"], category: "Design", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 15, high: 75 } },
  { name: "Canva", domains: ["canva.com"], category: "Design", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 10, high: 30 } },

  // ════════════════════════════════════════════
  // FINANCE & ACCOUNTING
  // ════════════════════════════════════════════
  { name: "QuickBooks Online", domains: ["intuit.com", "qbo.intuit.com", "c1.qbo.intuit.com", "quickbooks.intuit.com"], category: "Accounting", pricingModel: "flat", flatMonthly: { low: 30, mid: 60, high: 200 } },
  { name: "Xero", domains: ["xero.com", "go.xero.com"], category: "Accounting", pricingModel: "flat", flatMonthly: { low: 15, mid: 42, high: 78 } },
  { name: "NetSuite", domains: ["netsuite.com", "system.netsuite.com", "oracle.com"], category: "ERP", pricingModel: "custom", pricePerSeatMonth: { low: 99, mid: 149, high: 249 }, notes: "$999/mo base + per-user" },
  { name: "SAP", domains: ["sap.com"], category: "ERP", pricingModel: "custom", pricePerSeatMonth: { low: 100, mid: 200, high: 400 } },
  { name: "Sage", domains: ["sage.com"], category: "Accounting", pricingModel: "flat", flatMonthly: { low: 25, mid: 49, high: 150 } },
  { name: "FreshBooks", domains: ["freshbooks.com"], category: "Accounting", pricingModel: "flat", flatMonthly: { low: 17, mid: 30, high: 55 } },
  { name: "Wave", domains: ["waveapps.com"], category: "Accounting", pricingModel: "flat", flatMonthly: { low: 0, mid: 0, high: 16 } },
  { name: "Bill.com", domains: ["bill.com", "app.bill.com", "hq.bill.com"], category: "AP/AR", pricingModel: "per-seat", pricePerSeatMonth: { low: 45, mid: 55, high: 79 } },
  { name: "Ramp", domains: ["ramp.com", "app.ramp.com"], category: "Corporate Card", pricingModel: "flat", flatMonthly: { low: 0, mid: 0, high: 15 }, notes: "Free tier available" },
  { name: "Brex", domains: ["brex.com", "app.brex.com"], category: "Corporate Card", pricingModel: "flat", flatMonthly: { low: 0, mid: 0, high: 12 } },
  { name: "Expensify", domains: ["expensify.com", "app.expensify.com"], category: "Expense Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 5, mid: 9, high: 18 } },
  { name: "Concur", domains: ["concur.com", "concursolutions.com"], category: "Expense Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 8, mid: 15, high: 30 } },
  { name: "Stripe", domains: ["stripe.com", "dashboard.stripe.com"], category: "Payments", pricingModel: "usage", notes: "2.9% + $0.30 per transaction" },
  { name: "Square", domains: ["squareup.com", "square.com"], category: "Payments", pricingModel: "usage", notes: "2.6% + $0.10 per transaction" },
  { name: "PayPal", domains: ["paypal.com"], category: "Payments", pricingModel: "usage", notes: "2.99% + fixed fee" },
  { name: "Gusto", domains: ["gusto.com", "app.gusto.com"], category: "Payroll", pricingModel: "per-seat", pricePerSeatMonth: { low: 6, mid: 12, high: 12 }, notes: "+$40-80/mo base" },
  { name: "ADP", domains: ["adp.com", "my.adp.com", "workforcenow.adp.com"], category: "Payroll", pricingModel: "per-seat", pricePerSeatMonth: { low: 10, mid: 15, high: 25 }, notes: "Varies by plan" },
  { name: "Paychex", domains: ["paychex.com"], category: "Payroll", pricingModel: "per-seat", pricePerSeatMonth: { low: 5, mid: 10, high: 20 } },
  { name: "Rippling", domains: ["rippling.com", "app.rippling.com"], category: "HR/Payroll", pricingModel: "per-seat", pricePerSeatMonth: { low: 8, mid: 15, high: 25 } },

  // ════════════════════════════════════════════
  // HR & PEOPLE
  // ════════════════════════════════════════════
  { name: "BambooHR", domains: ["bamboohr.com", "app.bamboohr.com"], category: "HRIS", pricingModel: "per-seat", pricePerSeatMonth: { low: 6, mid: 8, high: 12 } },
  { name: "Workday", domains: ["workday.com", "myworkday.com"], category: "HRIS", pricingModel: "custom", pricePerSeatMonth: { low: 50, mid: 100, high: 200 } },
  { name: "Namely", domains: ["namely.com"], category: "HRIS", pricingModel: "per-seat", pricePerSeatMonth: { low: 9, mid: 15, high: 25 } },
  { name: "Lattice", domains: ["lattice.com"], category: "Performance", pricingModel: "per-seat", pricePerSeatMonth: { low: 4, mid: 8, high: 11 } },
  { name: "Culture Amp", domains: ["cultureamp.com"], category: "Performance", pricingModel: "per-seat", pricePerSeatMonth: { low: 5, mid: 8, high: 12 } },
  { name: "15Five", domains: ["15five.com"], category: "Performance", pricingModel: "per-seat", pricePerSeatMonth: { low: 4, mid: 8, high: 16 } },
  { name: "Greenhouse", domains: ["greenhouse.io"], category: "ATS", pricingModel: "custom", pricePerSeatMonth: { low: 50, mid: 100, high: 200 }, notes: "Per recruiter seat" },
  { name: "Lever", domains: ["lever.co"], category: "ATS", pricingModel: "custom", pricePerSeatMonth: { low: 40, mid: 80, high: 150 } },
  { name: "Ashby", domains: ["ashbyhq.com"], category: "ATS", pricingModel: "custom", pricePerSeatMonth: { low: 30, mid: 60, high: 100 } },
  { name: "Deel", domains: ["deel.com", "app.deel.com"], category: "Global Payroll", pricingModel: "per-seat", pricePerSeatMonth: { low: 29, mid: 49, high: 99 } },

  // ════════════════════════════════════════════
  // CLOUD & INFRASTRUCTURE
  // ════════════════════════════════════════════
  { name: "AWS", domains: ["aws.amazon.com", "console.aws.amazon.com", "amazonaws.com", "amazon.com"], category: "Cloud", pricingModel: "usage", notes: "Varies widely. Typical SMB: $500-5000/mo" },
  { name: "Google Cloud", domains: ["cloud.google.com", "console.cloud.google.com", "googleapis.com"], category: "Cloud", pricingModel: "usage", notes: "Varies widely" },
  { name: "Microsoft Azure", domains: ["azure.com", "portal.azure.com", "microsoft.com"], category: "Cloud", pricingModel: "usage", notes: "Varies widely" },
  { name: "Vercel", domains: ["vercel.com"], category: "Hosting", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 20, high: 50 } },
  { name: "Netlify", domains: ["netlify.com", "app.netlify.com"], category: "Hosting", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 19, high: 99 } },
  { name: "Heroku", domains: ["heroku.com"], category: "Hosting", pricingModel: "usage", flatMonthly: { low: 5, mid: 25, high: 250 } },
  { name: "DigitalOcean", domains: ["digitalocean.com"], category: "Cloud", pricingModel: "usage", flatMonthly: { low: 5, mid: 50, high: 500 } },
  { name: "Cloudflare", domains: ["cloudflare.com"], category: "CDN/Security", pricingModel: "flat", flatMonthly: { low: 0, mid: 20, high: 200 } },
  { name: "Datadog", domains: ["datadoghq.com", "app.datadoghq.com"], category: "Monitoring", pricingModel: "per-seat", pricePerSeatMonth: { low: 15, mid: 23, high: 34 }, notes: "Per host" },
  { name: "New Relic", domains: ["newrelic.com", "one.newrelic.com"], category: "Monitoring", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 49, high: 99 } },
  { name: "PagerDuty", domains: ["pagerduty.com", "app.pagerduty.com"], category: "Incident Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 21, high: 41 } },
  { name: "Sentry", domains: ["sentry.io"], category: "Error Tracking", pricingModel: "flat", flatMonthly: { low: 0, mid: 26, high: 80 } },
  { name: "LaunchDarkly", domains: ["launchdarkly.com"], category: "Feature Flags", pricingModel: "per-seat", pricePerSeatMonth: { low: 10, mid: 20, high: 30 } },

  // ════════════════════════════════════════════
  // DEVELOPER TOOLS
  // ════════════════════════════════════════════
  { name: "GitHub", domains: ["github.com"], category: "Dev Tools", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 4, high: 21 } },
  { name: "GitLab", domains: ["gitlab.com"], category: "Dev Tools", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 29, high: 99 } },
  { name: "Bitbucket", domains: ["bitbucket.org", "bitbucket.com"], category: "Dev Tools", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 3, high: 6 } },
  { name: "CircleCI", domains: ["circleci.com"], category: "CI/CD", pricingModel: "usage", flatMonthly: { low: 0, mid: 30, high: 100 } },
  { name: "Jenkins", domains: ["jenkins.io"], category: "CI/CD", pricingModel: "flat", flatMonthly: { low: 0, mid: 0, high: 0 }, notes: "Self-hosted, free" },
  { name: "Docker", domains: ["docker.com", "hub.docker.com"], category: "Containers", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 7, high: 24 } },
  { name: "Postman", domains: ["postman.com"], category: "API Tools", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 14, high: 49 } },
  { name: "Cursor", domains: ["cursor.com", "cursor.sh"], category: "IDE", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 20, high: 40 } },

  // ════════════════════════════════════════════
  // MARKETING
  // ════════════════════════════════════════════
  { name: "Mailchimp", domains: ["mailchimp.com"], category: "Email Marketing", pricingModel: "tiered", flatMonthly: { low: 0, mid: 20, high: 350 } },
  { name: "SendGrid", domains: ["sendgrid.com", "sendgrid.net"], category: "Email", pricingModel: "tiered", flatMonthly: { low: 0, mid: 20, high: 90 } },
  { name: "Intercom", domains: ["intercom.com", "intercom.io"], category: "Customer Support", pricingModel: "per-seat", pricePerSeatMonth: { low: 39, mid: 99, high: 139 } },
  { name: "Zendesk", domains: ["zendesk.com"], category: "Customer Support", pricingModel: "per-seat", pricePerSeatMonth: { low: 19, mid: 55, high: 115 } },
  { name: "Freshdesk", domains: ["freshdesk.com", "freshworks.com"], category: "Customer Support", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 15, high: 79 } },
  { name: "Drift", domains: ["drift.com"], category: "Chat/Sales", pricingModel: "flat", flatMonthly: { low: 0, mid: 400, high: 1500 } },
  { name: "Segment", domains: ["segment.com", "segment.io"], category: "Analytics", pricingModel: "usage", flatMonthly: { low: 0, mid: 120, high: 500 } },
  { name: "Mixpanel", domains: ["mixpanel.com"], category: "Analytics", pricingModel: "usage", flatMonthly: { low: 0, mid: 25, high: 200 } },
  { name: "Amplitude", domains: ["amplitude.com"], category: "Analytics", pricingModel: "usage", flatMonthly: { low: 0, mid: 49, high: 500 } },
  { name: "Google Analytics", domains: ["analytics.google.com"], category: "Analytics", pricingModel: "flat", flatMonthly: { low: 0, mid: 0, high: 150000 }, notes: "Free version. GA360 is $150K/yr" },
  { name: "Hotjar", domains: ["hotjar.com"], category: "Analytics", pricingModel: "flat", flatMonthly: { low: 0, mid: 32, high: 80 } },
  { name: "Semrush", domains: ["semrush.com"], category: "SEO", pricingModel: "flat", flatMonthly: { low: 130, mid: 250, high: 500 } },
  { name: "Ahrefs", domains: ["ahrefs.com"], category: "SEO", pricingModel: "flat", flatMonthly: { low: 99, mid: 199, high: 399 } },
  { name: "Hootsuite", domains: ["hootsuite.com"], category: "Social Media", pricingModel: "flat", flatMonthly: { low: 99, mid: 249, high: 739 } },
  { name: "Buffer", domains: ["buffer.com"], category: "Social Media", pricingModel: "flat", flatMonthly: { low: 0, mid: 5, high: 100 } },
  { name: "ActiveCampaign", domains: ["activecampaign.com"], category: "Marketing Automation", pricingModel: "tiered", flatMonthly: { low: 29, mid: 49, high: 149 } },
  { name: "Marketo", domains: ["marketo.com", "mkto-sj130042.com"], category: "Marketing Automation", pricingModel: "custom", flatMonthly: { low: 895, mid: 1795, high: 3195 } },
  { name: "Pardot", domains: ["pardot.com"], category: "Marketing Automation", pricingModel: "flat", flatMonthly: { low: 1250, mid: 2500, high: 4000 } },

  // ════════════════════════════════════════════
  // SECURITY & IDENTITY
  // ════════════════════════════════════════════
  { name: "Okta", domains: ["okta.com"], category: "Identity", pricingModel: "per-seat", pricePerSeatMonth: { low: 2, mid: 6, high: 15 } },
  { name: "Auth0", domains: ["auth0.com"], category: "Identity", pricingModel: "usage", flatMonthly: { low: 0, mid: 23, high: 240 } },
  { name: "1Password", domains: ["1password.com"], category: "Password Manager", pricingModel: "per-seat", pricePerSeatMonth: { low: 3, mid: 8, high: 8 } },
  { name: "LastPass", domains: ["lastpass.com"], category: "Password Manager", pricingModel: "per-seat", pricePerSeatMonth: { low: 3, mid: 4, high: 7 } },
  { name: "Dashlane", domains: ["dashlane.com"], category: "Password Manager", pricingModel: "per-seat", pricePerSeatMonth: { low: 5, mid: 8, high: 8 } },
  { name: "CrowdStrike", domains: ["crowdstrike.com"], category: "Endpoint Security", pricingModel: "per-seat", pricePerSeatMonth: { low: 5, mid: 10, high: 18 }, notes: "Per endpoint" },
  { name: "SentinelOne", domains: ["sentinelone.com"], category: "Endpoint Security", pricingModel: "per-seat", pricePerSeatMonth: { low: 5, mid: 8, high: 12 } },
  { name: "Snyk", domains: ["snyk.io"], category: "App Security", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 57, high: 115 } },
  { name: "Vanta", domains: ["vanta.com"], category: "Compliance", pricingModel: "flat", flatMonthly: { low: 500, mid: 1000, high: 2000 } },
  { name: "Drata", domains: ["drata.com"], category: "Compliance", pricingModel: "flat", flatMonthly: { low: 500, mid: 1000, high: 2500 } },
  { name: "KnowBe4", domains: ["knowbe4.com"], category: "Security Training", pricingModel: "per-seat", pricePerSeatMonth: { low: 2, mid: 3, high: 5 } },

  // ════════════════════════════════════════════
  // STORAGE & FILE SHARING
  // ════════════════════════════════════════════
  { name: "Google Workspace", domains: ["google.com", "admin.google.com", "workspace.google.com"], category: "Productivity Suite", pricingModel: "per-seat", pricePerSeatMonth: { low: 7, mid: 14, high: 22 } },
  { name: "Microsoft 365", domains: ["office.com", "office365.com", "outlook.office.com", "sharepoint.com"], category: "Productivity Suite", pricingModel: "per-seat", pricePerSeatMonth: { low: 6, mid: 12.50, high: 22 } },
  { name: "Dropbox", domains: ["dropbox.com"], category: "Storage", pricingModel: "per-seat", pricePerSeatMonth: { low: 10, mid: 15, high: 24 } },
  { name: "Box", domains: ["box.com", "app.box.com"], category: "Storage", pricingModel: "per-seat", pricePerSeatMonth: { low: 5, mid: 15, high: 25 } },
  { name: "Google Drive", domains: ["drive.google.com"], category: "Storage", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 3, high: 15 }, notes: "Included in Workspace" },
  { name: "OneDrive", domains: ["onedrive.live.com"], category: "Storage", pricingModel: "per-seat", pricePerSeatMonth: { low: 2, mid: 5, high: 10 }, notes: "Included in M365" },
  { name: "SharePoint", domains: ["sharepoint.com"], category: "Document Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 5, mid: 10, high: 20 } },

  // ════════════════════════════════════════════
  // LEGAL & CONTRACTS
  // ════════════════════════════════════════════
  { name: "DocuSign", domains: ["docusign.com", "docusign.net"], category: "E-Signature", pricingModel: "per-seat", pricePerSeatMonth: { low: 10, mid: 25, high: 40 } },
  { name: "PandaDoc", domains: ["pandadoc.com"], category: "Proposals/Contracts", pricingModel: "per-seat", pricePerSeatMonth: { low: 19, mid: 49, high: 65 } },
  { name: "HelloSign", domains: ["hellosign.com"], category: "E-Signature", pricingModel: "per-seat", pricePerSeatMonth: { low: 15, mid: 25, high: 40 } },
  { name: "Ironclad", domains: ["ironcladapp.com"], category: "CLM", pricingModel: "custom", pricePerSeatMonth: { low: 50, mid: 100, high: 200 } },

  // ════════════════════════════════════════════
  // CUSTOMER SUCCESS
  // ════════════════════════════════════════════
  { name: "Gainsight", domains: ["gainsight.com"], category: "Customer Success", pricingModel: "custom", pricePerSeatMonth: { low: 75, mid: 150, high: 250 } },
  { name: "ChurnZero", domains: ["churnzero.com"], category: "Customer Success", pricingModel: "custom", pricePerSeatMonth: { low: 50, mid: 100, high: 200 } },
  { name: "Vitally", domains: ["vitally.io"], category: "Customer Success", pricingModel: "per-seat", pricePerSeatMonth: { low: 30, mid: 60, high: 100 } },

  // ════════════════════════════════════════════
  // DATA & BI
  // ════════════════════════════════════════════
  { name: "Tableau", domains: ["tableau.com"], category: "BI", pricingModel: "per-seat", pricePerSeatMonth: { low: 15, mid: 42, high: 75 } },
  { name: "Looker", domains: ["looker.com"], category: "BI", pricingModel: "per-seat", pricePerSeatMonth: { low: 30, mid: 60, high: 125 } },
  { name: "Power BI", domains: ["powerbi.com", "app.powerbi.com"], category: "BI", pricingModel: "per-seat", pricePerSeatMonth: { low: 10, mid: 10, high: 20 } },
  { name: "Metabase", domains: ["metabase.com"], category: "BI", pricingModel: "flat", flatMonthly: { low: 0, mid: 85, high: 500 } },
  { name: "Snowflake", domains: ["snowflake.com", "snowflakecomputing.com"], category: "Data Warehouse", pricingModel: "usage", notes: "Pay per query. Typical: $200-5000/mo" },
  { name: "BigQuery", domains: ["bigquery.cloud.google.com"], category: "Data Warehouse", pricingModel: "usage", notes: "Pay per query" },
  { name: "Databricks", domains: ["databricks.com"], category: "Data Platform", pricingModel: "usage", notes: "DBU-based pricing" },
  { name: "dbt", domains: ["getdbt.com"], category: "Data Transform", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 50, high: 100 } },
  { name: "Fivetran", domains: ["fivetran.com"], category: "Data Integration", pricingModel: "usage", flatMonthly: { low: 0, mid: 120, high: 500 } },
  { name: "Stitch", domains: ["stitchdata.com"], category: "Data Integration", pricingModel: "usage", flatMonthly: { low: 0, mid: 100, high: 300 } },

  // ════════════════════════════════════════════
  // E-COMMERCE
  // ════════════════════════════════════════════
  { name: "Shopify", domains: ["shopify.com", "myshopify.com"], category: "E-Commerce", pricingModel: "flat", flatMonthly: { low: 39, mid: 105, high: 399 } },
  { name: "BigCommerce", domains: ["bigcommerce.com"], category: "E-Commerce", pricingModel: "flat", flatMonthly: { low: 39, mid: 105, high: 399 } },
  { name: "WooCommerce", domains: ["woocommerce.com"], category: "E-Commerce", pricingModel: "flat", flatMonthly: { low: 0, mid: 25, high: 50 }, notes: "Hosting + plugins" },

  // ════════════════════════════════════════════
  // INDUSTRY SPECIFIC
  // ════════════════════════════════════════════
  { name: "Procore", domains: ["procore.com"], category: "Construction", pricingModel: "custom", flatMonthly: { low: 500, mid: 1000, high: 3000 } },
  { name: "ServiceTitan", domains: ["servicetitan.com"], category: "Field Service", pricingModel: "custom", flatMonthly: { low: 300, mid: 500, high: 1500 } },
  { name: "Toast", domains: ["toasttab.com"], category: "Restaurant", pricingModel: "flat", flatMonthly: { low: 0, mid: 69, high: 165 } },
  { name: "Clio", domains: ["clio.com"], category: "Legal", pricingModel: "per-seat", pricePerSeatMonth: { low: 39, mid: 69, high: 129 } },
  { name: "Veeva", domains: ["veeva.com"], category: "Life Sciences", pricingModel: "custom", pricePerSeatMonth: { low: 100, mid: 200, high: 400 } },
  { name: "Epic", domains: ["epic.com"], category: "Healthcare EHR", pricingModel: "custom", notes: "Enterprise pricing, typically $500K+" },
  { name: "Athenahealth", domains: ["athenahealth.com"], category: "Healthcare", pricingModel: "usage", notes: "% of collections" },
  { name: "HCSS", domains: ["hcss.com"], category: "Construction/Heavy Civil", pricingModel: "custom", flatMonthly: { low: 200, mid: 500, high: 2000 } },
  { name: "Kronos/UKG", domains: ["kronos.com", "ukg.com", "ultimatesoftware.com"], category: "Workforce Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 5, mid: 10, high: 20 } },
  { name: "Fleetio", domains: ["fleetio.com"], category: "Fleet Management", pricingModel: "per-seat", pricePerSeatMonth: { low: 5, mid: 7, high: 10 }, notes: "Per vehicle" },
  { name: "Samsara", domains: ["samsara.com"], category: "Fleet/IoT", pricingModel: "per-seat", pricePerSeatMonth: { low: 20, mid: 30, high: 50 }, notes: "Per vehicle/asset" },
  { name: "eCMS", domains: ["ecms.com", "computerease.com"], category: "Construction ERP", pricingModel: "custom", flatMonthly: { low: 500, mid: 1000, high: 3000 } },

  // ════════════════════════════════════════════
  // AI & AUTOMATION
  // ════════════════════════════════════════════
  { name: "OpenAI", domains: ["openai.com", "api.openai.com", "chatgpt.com"], category: "AI", pricingModel: "usage", flatMonthly: { low: 0, mid: 20, high: 200 } },
  { name: "Anthropic", domains: ["anthropic.com", "claude.ai", "api.anthropic.com"], category: "AI", pricingModel: "usage", flatMonthly: { low: 0, mid: 20, high: 200 } },
  { name: "Zapier", domains: ["zapier.com"], category: "Automation", pricingModel: "flat", flatMonthly: { low: 0, mid: 20, high: 100 } },
  { name: "Make (Integromat)", domains: ["make.com", "integromat.com"], category: "Automation", pricingModel: "flat", flatMonthly: { low: 0, mid: 9, high: 29 } },
  { name: "UiPath", domains: ["uipath.com"], category: "RPA", pricingModel: "custom", flatMonthly: { low: 420, mid: 1000, high: 3000 } },
  { name: "Automation Anywhere", domains: ["automationanywhere.com"], category: "RPA", pricingModel: "custom", flatMonthly: { low: 500, mid: 1500, high: 5000 } },

  // ════════════════════════════════════════════
  // LEARNING & TRAINING
  // ════════════════════════════════════════════
  { name: "LinkedIn Learning", domains: ["linkedin.com"], category: "Learning", pricingModel: "per-seat", pricePerSeatMonth: { low: 20, mid: 30, high: 30 } },
  { name: "Udemy Business", domains: ["udemy.com"], category: "Learning", pricingModel: "per-seat", pricePerSeatMonth: { low: 15, mid: 25, high: 30 } },
  { name: "Coursera", domains: ["coursera.org"], category: "Learning", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 30, high: 60 } },

  // ════════════════════════════════════════════
  // INSURANCE SPECIFIC
  // ════════════════════════════════════════════
  { name: "Guidewire", domains: ["guidewire.com"], category: "Insurance Platform", pricingModel: "custom", notes: "Enterprise: $500K-5M/yr" },
  { name: "Duck Creek", domains: ["duckcreek.com"], category: "Insurance Platform", pricingModel: "custom", notes: "Enterprise pricing" },
  { name: "Applied Epic", domains: ["appliedsystems.com"], category: "Insurance Agency", pricingModel: "per-seat", pricePerSeatMonth: { low: 50, mid: 100, high: 200 } },
  { name: "Vertafore", domains: ["vertafore.com"], category: "Insurance Agency", pricingModel: "per-seat", pricePerSeatMonth: { low: 40, mid: 80, high: 150 } },
  { name: "Majesco", domains: ["majesco.com"], category: "Insurance Platform", pricingModel: "custom", notes: "Enterprise pricing" },

  // ════════════════════════════════════════════
  // MISC BUSINESS TOOLS
  // ════════════════════════════════════════════
  { name: "Twilio", domains: ["twilio.com"], category: "Communications API", pricingModel: "usage", notes: "Pay per message/minute" },
  { name: "Typeform", domains: ["typeform.com"], category: "Forms", pricingModel: "flat", flatMonthly: { low: 0, mid: 25, high: 83 } },
  { name: "SurveyMonkey", domains: ["surveymonkey.com"], category: "Surveys", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 25, high: 75 } },
  { name: "Carta", domains: ["carta.com"], category: "Cap Table", pricingModel: "flat", flatMonthly: { low: 0, mid: 83, high: 250 } },
  { name: "AngelList", domains: ["angellist.com"], category: "Cap Table", pricingModel: "flat", flatMonthly: { low: 0, mid: 0, high: 0 } },
  { name: "Superhuman", domains: ["superhuman.com"], category: "Email", pricingModel: "per-seat", pricePerSeatMonth: { low: 25, mid: 25, high: 33 } },
  { name: "Front", domains: ["frontapp.com"], category: "Email", pricingModel: "per-seat", pricePerSeatMonth: { low: 19, mid: 49, high: 99 } },
  { name: "Grammarly", domains: ["grammarly.com"], category: "Writing", pricingModel: "per-seat", pricePerSeatMonth: { low: 0, mid: 12, high: 25 } },
  { name: "Jasper", domains: ["jasper.ai"], category: "AI Writing", pricingModel: "per-seat", pricePerSeatMonth: { low: 39, mid: 59, high: 125 } },
  { name: "Webflow", domains: ["webflow.com"], category: "Website Builder", pricingModel: "flat", flatMonthly: { low: 0, mid: 18, high: 49 } },
  { name: "WordPress", domains: ["wordpress.com", "wp.com"], category: "CMS", pricingModel: "flat", flatMonthly: { low: 0, mid: 8, high: 45 } },
  { name: "HubSpot CMS", domains: ["hubspot.com"], category: "CMS", pricingModel: "flat", flatMonthly: { low: 0, mid: 25, high: 400 } },
];

// Build a lookup index for fast domain matching
// Stores arrays to handle multiple apps per domain (e.g. HubSpot CRM vs HubSpot CMS)
const domainIndex = new Map<string, SaaSApp[]>();
for (const app of SAAS_DATABASE) {
  for (const domain of app.domains) {
    if (!domainIndex.has(domain)) domainIndex.set(domain, []);
    domainIndex.get(domain)!.push(app);
    const parts = domain.split(".");
    if (parts.length > 2) {
      const parent = parts.slice(-2).join(".");
      if (!domainIndex.has(parent)) domainIndex.set(parent, []);
      domainIndex.get(parent)!.push(app);
    }
  }
}

export function lookupDomain(domain: string): SaaSApp | undefined {
  domain = domain.toLowerCase().replace(/^www\./, "");
  const matches = domainIndex.get(domain);
  if (matches && matches.length > 0) return matches[0];
  const parts = domain.split(".");
  if (parts.length > 2) {
    const parent = parts.slice(-2).join(".");
    const parentMatches = domainIndex.get(parent);
    if (parentMatches && parentMatches.length > 0) return parentMatches[0];
  }
  return undefined;
}

// Returns all apps matching a domain (for multi-product vendors like HubSpot, Atlassian)
export function lookupDomainAll(domain: string): SaaSApp[] {
  domain = domain.toLowerCase().replace(/^www\./, "");
  const matches = domainIndex.get(domain);
  if (matches && matches.length > 0) return matches;
  const parts = domain.split(".");
  if (parts.length > 2) {
    const parent = parts.slice(-2).join(".");
    return domainIndex.get(parent) || [];
  }
  return [];
}

// Estimate annual cost. Uses emailCount as a seat proxy when available
// (much more accurate than assuming entire org uses every tool).
export function estimateAnnualCost(app: SaaSApp, userCount: number, emailCount?: number): { low: number; mid: number; high: number } | null {
  if (app.pricePerSeatMonth) {
    // Use email activity as a seat proxy: if we see 15 emails from Salesforce
    // in a 30-person org, estimate ~15 seats, not 30
    const estimatedSeats = emailCount ? Math.max(1, Math.min(userCount, Math.ceil(emailCount / 3))) : userCount;
    return {
      low: app.pricePerSeatMonth.low * estimatedSeats * 12,
      mid: app.pricePerSeatMonth.mid * estimatedSeats * 12,
      high: app.pricePerSeatMonth.high * estimatedSeats * 12,
    };
  }
  if (app.flatMonthly) {
    return {
      low: app.flatMonthly.low * 12,
      mid: app.flatMonthly.mid * 12,
      high: app.flatMonthly.high * 12,
    };
  }
  return null;
}

export function formatCost(amount: number): string {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

export const TOTAL_APPS = SAAS_DATABASE.length;
export const TOTAL_DOMAINS = domainIndex.size;
