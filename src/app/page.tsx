"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// Parse dollar string to a raw number in dollars (not thousands).
// "$2.3M" → 2300000, "$340K" → 340000, "$500" → 500
function parseDollarToRaw(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/[^0-9.KMBkmb]/g, "");
  const numPart = parseFloat(cleaned) || 0;
  const upper = s.toUpperCase();
  if (upper.includes("B")) return numPart * 1_000_000_000;
  if (upper.includes("M")) return numPart * 1_000_000;
  if (upper.includes("K")) return numPart * 1_000;
  return numPart; // raw dollar amount, no suffix
}

// Format a raw dollar amount for display
function formatDollarDisplay(raw: number): string {
  if (raw >= 1_000_000_000) return `${(raw / 1_000_000_000).toFixed(1)}B`;
  if (raw >= 1_000_000) return `${(raw / 1_000_000).toFixed(1)}M`;
  if (raw >= 1_000) return `${Math.round(raw / 1_000).toLocaleString()}K`;
  return `${Math.round(raw).toLocaleString()}`;
}

type Finding = {
  id: number;
  title: string;
  description: string;
  amount: string | null;
  severity: "critical" | "high" | "medium";
  category: string;
  agent?: string;
  department?: string;
  recommendation?: string;
  evidence?: string;
  timeToValue?: string;
};

type ScanMode = "loading" | "choose" | "uploading" | "scanning" | "done";

type AgentLogEntry = {
  id: number;
  agent: string;
  message: string;
  timestamp: string;
  type: "discovery" | "analysis" | "finding" | "progress";
};

type TechStackApp = {
  name: string;
  category: string;
  estimatedCost: string;
  emailActivity: number;
  actualAmounts?: number[];
};

type GapItem = {
  priority?: number;
  type?: "connect_app" | "upload_data" | "desktop_scan" | "manual_input";
  appName?: string;
  icon?: string;
  title?: string;
  description?: string;
  howToProvide?: string;
  expectedFindings?: number;
  expectedValue?: string;
  unlocks?: string[];
  coverageBefore?: number;
  coverageAfter?: number;
  // Legacy fields for backward compat with file scan
  section?: string;
  status?: "populated" | "partial" | "empty";
  coverage?: number;
  dataNeeded?: string;
};

type ScanSummary = {
  totalAnnualSpend?: string;
  totalAnnualWaste?: string;
  totalAutomatableHours?: string;
  findingsCount?: number;
  criticalCount?: number;
  appsDiscovered?: number;
  workflowsDiscovered?: number;
  workflowsAutomatable?: number;
  coverageScore?: number;
  spendByCategory?: Record<string, string>;
};

type OrgIntelligence = {
  emailsAnalyzed: number;
  financialEmails: number;
  calendarEvents: number;
  driveDocuments: number;
  orgDomain: string;
  orgSize: number;
  internalContacts: number;
  externalDomains: number;
  meetingHours6mo: number;
  recurringMeetings: number;
  externalMeetings: number;
  videoTools: string[];
  sharedSpreadsheets: number;
  humanMiddleware: { email: string; forwardRatio: number }[];
  topCommunicators: { email: string; sent: number; received: number; total: number }[];
  topVendorMeetings: { domain: string; meetings: number }[];
  recurringProcesses: { sender: string; pattern: string; frequency: string; dayOfWeek: string; recipients: number; occurrences: number }[];
  deepThreads: number;
  attachmentThreads: number;
  gmailLabels: string[];
  roleInboxes: string[];
};

export default function Home() {
  const [mode, setMode] = useState<ScanMode>("loading");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);
  const [scanProgress, setScanProgress] = useState({ records: 0, scanned: 0, message: "" });
  const [fileName, setFileName] = useState("");
  const [totalSavings, setTotalSavings] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSource, setScanSource] = useState<"file" | "google-admin" | "google-personal">("file");
  const [techStack, setTechStack] = useState<TechStackApp[]>([]);
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [summary, setSummary] = useState<ScanSummary>({});
  const [renewals, setRenewals] = useState<{ vendor: string; renewalDate: string; estimatedCost: string; action: string; urgency: string }[]>([]);
  const [automations, setAutomations] = useState<{ process: string; evidence: string; estimatedTimeSavings: string; recommendedTool: string; complexity: string }[]>([]);
  const [workflows, setWorkflows] = useState<{ name: string; type: string; description: string; frequency: string; participants: string[]; automationScore: number; agentBlueprint?: { trigger: string; steps: string[]; humanInTheLoop: string; complexity: string }; estimatedTimeSavings: string; estimatedAnnualSavings: string; evidence: string }[]>([]);
  const [activeSection, setActiveSection] = useState<"spend" | "workflows" | "waste" | null>(null);
  const [orgIntel, setOrgIntel] = useState<OrgIntelligence | null>(null);
  const addAgentLog = useCallback((agent: string, message: string, type: AgentLogEntry["type"] = "progress") => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    setAgentLog((prev) => [{ id: Date.now(), agent, message, timestamp, type }, ...prev].slice(0, 30));
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setScanSource("file");
    setMode("uploading");
    setFindings([]);
    setTotalSavings(0);
    setScanError(null);
    setAgentLog([]);
    setTechStack([]);
    setGaps([]);
    setSummary({});
    setRenewals([]);
    setAutomations([]);
    setWorkflows([]);
    setOrgIntel(null);
    setActiveSection(null);

    const formData = new FormData();
    formData.append("file", file);

    setTimeout(() => {
      setMode("scanning");
      addAgentLog("Dispatch", `Received ${file.name} for analysis`, "progress");
    }, 600);

    try {
      const res = await fetch("/api/scan", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Scan failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let findingId = 0;

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") { setMode("done"); continue; }
          try {
            const event = JSON.parse(data);
            if (event.type === "error") {
              setScanError(event.message || "Analysis failed. Please try again.");
              setMode("choose");
              return;
            } else if (event.type === "agent-log") {
              addAgentLog(event.agent, event.message, event.logType || "progress");
            } else if (event.type === "progress") {
              setScanProgress(event);
            } else if (event.type === "summary") {
              setSummary(event);
            } else if (event.type === "finding") {
              findingId++;
              const finding: Finding = { id: findingId, ...event };
              setFindings((prev) => [...prev, finding]);
              addAgentLog(event.agent || "Ledger", `${event.title}${event.amount ? " — " + event.amount : ""}`, "finding");
              if (event.amount) {
                const raw = parseDollarToRaw(event.amount);
                if (raw > 0) setTotalSavings((prev) => prev + raw);
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed. Please try again.");
      setMode("choose");
    }
  }, [addAgentLog]);

  const startGoogleScan = useCallback(async (adminMode: boolean) => {
    setScanSource(adminMode ? "google-admin" : "google-personal");
    setFindings([]);
    setTotalSavings(0);
    setScanError(null);
    setAgentLog([]);
    setTechStack([]);
    setGaps([]);
    setSummary({});
    setRenewals([]);
    setAutomations([]);
    setWorkflows([]);
    setOrgIntel(null);
    setActiveSection(null);

    // Show loading spinner while we check if OAuth is needed
    setMode("loading");

    try {
      const scopes = adminMode
        ? "admin-directory-readonly,gmail-readonly,drive-readonly"
        : "gmail-readonly";
      const res = await fetch(`/api/scan-google?mode=${adminMode ? "admin" : "personal"}&scopes=${scopes}`, { method: "POST" });
      if (!res.ok) {
        // If 401, redirect to Google OAuth (stay in loading state during redirect)
        if (res.status === 401) {
          const { authUrl } = await res.json();
          window.location.href = authUrl;
          return;
        }
        if (res.status === 429) {
          const data = await res.json();
          throw new Error(data.error || "Rate limit exceeded. Please try again later.");
        }
        throw new Error("Scan failed. Please try again.");
      }

      // Token valid, stream starting. NOW show scanning UI.
      setMode("scanning");
      addAgentLog("Dispatch", adminMode ? "Initiating full org scan..." : "Initiating personal scan...", "progress");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let findingId = 0;

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") { setMode("done"); continue; }
          try {
            const event = JSON.parse(data);
            if (event.type === "error") {
              setScanError(event.message || "Analysis failed. Please try again.");
              setMode("choose");
              return;
            } else if (event.type === "agent-log") {
              addAgentLog(event.agent, event.message, event.logType || "progress");
            } else if (event.type === "progress") {
              setScanProgress(event);
            } else if (event.type === "techStack") {
              setTechStack(event.apps || []);
              setSummary((prev) => ({ ...prev, totalAnnualSpend: event.totalEstimatedSpend, appsDiscovered: event.appCount }));
            } else if (event.type === "orgIntelligence") {
              setOrgIntel(event as unknown as OrgIntelligence);
            } else if (event.type === "summary") {
              setSummary(event);
              if (event.renewalCalendar) setRenewals(event.renewalCalendar);
              if (event.automationOpportunities) setAutomations(event.automationOpportunities);
            } else if (event.type === "gaps") {
              setGaps(event.gaps || []);
            } else if (event.type === "workflows") {
              setWorkflows(event.workflows || []);
            } else if (event.type === "renewals") {
              setRenewals(event.renewals || []);
            } else if (event.type === "automations") {
              setAutomations(event.automations || []);
            } else if (event.type === "finding") {
              findingId++;
              setFindings((prev) => [...prev, { id: findingId, ...event }]);
              addAgentLog(event.agent || "Ledger", `${event.title}${event.amount ? " — " + event.amount : ""}`, "finding");
              if (event.amount) {
                const raw = parseDollarToRaw(event.amount);
                if (raw > 0) setTotalSavings((prev) => prev + raw);
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed. Please try again.");
      setMode("choose");
    }
  }, [addAgentLog]);

  // Check for OAuth callback, errors, OR load saved results
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Handle OAuth errors from redirects
    const error = params.get("error");
    if (error) {
      const errorMessages: Record<string, string> = {
        no_code: "Authentication failed. No authorization code received.",
        auth_failed: "Authentication failed. Please try signing in again.",
        csrf_failed: "Security check failed. Please try signing in again.",
      };
      setScanError(errorMessages[error] || `Authentication error: ${error}`);
      window.history.replaceState({}, "", "/");
      setMode("choose");
      return;
    }

    if (params.get("scan") === "ready") {
      const scanMode = params.get("mode") || "crawl";
      window.history.replaceState({}, "", "/");

      // Microsoft OAuth completed but scanning not yet implemented
      if (scanMode === "microsoft") {
        setScanError("Microsoft scanning is coming soon. Your account was connected successfully. Please use Google sign-in for scanning in the meantime.");
        setMode("choose");
        return;
      }

      const adminMode = scanMode === "admin";
      startGoogleScan(adminMode);
      return;
    }

    // Try to load saved scan results
    fetch("/api/scan-results")
      .then((res) => res.json())
      .then((data) => {
        if (data.scan) {
          const s = data.scan;
          setSummary(s.summary || {});
          // Tech stack from DB uses backend field names; map to frontend shape
          if (s.tech_stack && Array.isArray(s.tech_stack)) {
            setTechStack(s.tech_stack.map((t: Record<string, unknown>) => ({
              name: t.name || "",
              category: t.category || "",
              estimatedCost: t.estimatedCost || (t.estimatedAnnualCost ? "~est." : "detected"),
              emailActivity: t.emailActivity || t.emailCount || 0,
              actualAmounts: t.actualAmounts || [],
            })));
          }
          setGaps(s.gaps || []);
          setRenewals(s.renewals || []);
          setAutomations(s.automations || []);
          if (s.findings && Array.isArray(s.findings)) {
            // Map snake_case DB fields to camelCase frontend fields
            setFindings(s.findings.map((f: Record<string, unknown>, i: number) => ({
              id: i + 1,
              title: f.title || "",
              description: f.description || "",
              amount: f.amount || null,
              severity: f.severity || "medium",
              category: f.category || "",
              agent: f.agent,
              department: f.department,
              recommendation: f.recommendation,
              evidence: f.evidence,
              timeToValue: f.timeToValue || f.time_to_value || undefined,
            })));
            const total = s.findings.reduce((sum: number, f: Record<string, unknown>) => {
              if (typeof f.amount !== "string") return sum;
              return sum + parseDollarToRaw(f.amount);
            }, 0);
            setTotalSavings(total);
          }
          if (s.agentLogs && Array.isArray(s.agentLogs)) {
            setAgentLog(s.agentLogs.map((l: Record<string, unknown>) => ({
              id: Date.now() + Math.random(),
              agent: String(l.agent || ""),
              message: String(l.message || ""),
              timestamp: l.created_at ? new Date(l.created_at as string).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "",
              type: (l.log_type || "progress") as AgentLogEntry["type"],
            })));
          }
          if (s.workflows && Array.isArray(s.workflows) && s.workflows.length > 0) {
            setWorkflows(s.workflows);
          }
          // Validate orgIntelligence has required fields before casting
          if (s.org_intelligence && typeof s.org_intelligence === "object" && typeof s.org_intelligence.emailsAnalyzed === "number") {
            setOrgIntel(s.org_intelligence as OrgIntelligence);
          }
          setScanSource(s.source || "google-personal");
          setMode("done");
        } else {
          setMode("choose");
        }
      })
      .catch(() => { setMode("choose"); });
  }, [startGoogleScan]);

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="pt-24 md:pt-32 px-5 md:px-18 max-w-5xl mx-auto pb-16">
        {scanError && (
          <div className="mb-6 p-4 rounded-xl flex items-start gap-3" style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="mt-0.5 flex-shrink-0">
              <circle cx="10" cy="10" r="9" stroke="#ef4444" strokeWidth="1.5"/>
              <path d="M10 6v5M10 13.5v.5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: "#991b1b" }}>{scanError}</p>
              <button onClick={() => setScanError(null)} className="text-xs mt-1 underline" style={{ color: "#b91c1c" }}>Dismiss</button>
            </div>
          </div>
        )}
        {mode === "loading" && (
          <div className="flex items-center justify-center py-32">
            <div className="w-5 h-5 rounded-full border-2 border-[#c4501e] border-t-transparent animate-spin" />
          </div>
        )}
        {mode === "choose" && (
          <ChooseMode startGoogleScan={startGoogleScan} setScanError={setScanError} />
        )}
        {mode === "uploading" && <UploadingState fileName={fileName} />}
        {mode === "scanning" && (
          <ScanningView
            progress={scanProgress}
            findings={findings}
            totalSavings={totalSavings}
            agentLog={agentLog}
            scanSource={scanSource}
            techStack={techStack}
            summary={summary}
          />
        )}
        {mode === "done" && (
          <DoneView
            findings={findings}
            agentLog={agentLog}
            techStack={techStack}
            gaps={gaps}
            summary={summary}
            renewals={renewals}
            automations={automations}
            workflows={workflows}
            orgIntel={orgIntel}
            activeSection={activeSection}
            setActiveSection={setActiveSection}
            handleFile={handleFile}
            onReset={() => { setMode("choose"); setFindings([]); setTotalSavings(0); setAgentLog([]); setTechStack([]); setGaps([]); setSummary({}); setRenewals([]); setAutomations([]); setWorkflows([]); setActiveSection(null); setOrgIntel(null); }}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

/* ─── NAV ─── */
function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 px-5 md:px-18 h-14 md:h-15 flex items-center justify-between" style={{ background: "rgba(250,249,247,0.88)", backdropFilter: "blur(24px)", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
      <a href="https://upskillerai.com" className="font-fraunces font-medium text-base md:text-lg" style={{ letterSpacing: "-0.03em" }}>UpSkiller</a>
      <div className="flex items-center gap-3 md:gap-4">
        <span className="text-xs font-semibold tracking-wider uppercase hidden sm:inline" style={{ color: "#a8a29e" }}>Scanner</span>
        <a href="mailto:scotty@upskillerai.com" className="text-xs md:text-sm font-semibold px-4 md:px-5 py-2 md:py-2.5 rounded-full bg-[#1a1a1a] text-[#faf9f7] hover:bg-[#333] transition-all">Talk to us</a>
      </div>
    </nav>
  );
}

/* ─── CHOOSE MODE ─── */
function ChooseMode({ startGoogleScan, setScanError }: {
  startGoogleScan: (admin: boolean) => void;
  setScanError: (error: string | null) => void;
}) {
  return (
    <div className="animate-fade-up max-w-2xl">
      <h1 className="font-fraunces text-3xl md:text-5xl font-light leading-snug md:leading-tight" style={{ letterSpacing: "-0.04em", textWrap: "balance" }}>
        See what your systems are sitting on.
      </h1>
      <p className="mt-4 md:mt-5 text-sm md:text-base leading-relaxed" style={{ color: "#6b6560" }}>
        One click. Our agents scan your email for every tool, vendor, and subscription you pay for. They read invoices, map your tech stack, estimate costs, and surface waste, all in under 5 minutes.
      </p>

      {/* Single CTA */}
      <button
        onClick={() => startGoogleScan(false)}
        className="mt-8 md:mt-10 w-full group text-left p-6 md:p-8 rounded-xl transition-all hover:-translate-y-1 hover:shadow-xl cursor-pointer"
        style={{ border: "1px solid #ddd8d0", background: "linear-gradient(180deg, rgba(250,249,247,1) 0%, rgba(240,237,232,0.5) 100%)" }}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg md:text-xl font-semibold mb-2">Start your free scan</h3>
            <p className="text-xs md:text-sm leading-relaxed" style={{ color: "#6b6560" }}>
              Sign in with Google and our agents will discover every app, read your invoices, map your vendors, and estimate your total SaaS spend. Read-only. Nothing stored.
            </p>
          </div>
          <div className="flex-shrink-0 w-11 h-11 md:w-14 md:h-14 rounded-full flex items-center justify-center" style={{ background: "#1a1a1a" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#faf9f7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
          </div>
        </div>
        <div className="mt-5 md:mt-6 flex items-center gap-3 text-sm font-semibold" style={{ color: "#1a1a1a" }}>
          <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>
          Sign in with Google
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="transition-transform group-hover:translate-x-1"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
      </button>

      {/* Google warning note */}
      <p className="mt-3 text-xs leading-relaxed" style={{ color: "#a8a29e" }}>
        Google will show a security warning because we&apos;re new. Click <b style={{ color: "#6b6560" }}>Advanced</b> then <b style={{ color: "#6b6560" }}>&ldquo;Go to upskiller-scanner.vercel.app&rdquo;</b> to proceed safely. We read email content for financial analysis but never store raw emails.
      </p>

      {/* Alternative sign-in options */}
      <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <button
          onClick={async () => {
            try {
              const res = await fetch("/api/auth/microsoft", { redirect: "manual" });
              if (res.status === 501) {
                setScanError("Microsoft sign-in is not yet available. Please use Google sign-in for now.");
                return;
              }
              // Follow the redirect
              const redirectUrl = res.headers.get("Location");
              if (redirectUrl) {
                window.location.href = redirectUrl;
              } else {
                window.location.href = "/api/auth/microsoft";
              }
            } catch {
              window.location.href = "/api/auth/microsoft";
            }
          }}
          className="text-center py-2.5 px-5 text-sm font-medium rounded-full transition-all hover:bg-[#f0ede8] flex items-center justify-center gap-2 cursor-pointer"
          style={{ border: "1px solid #ddd8d0", color: "#6b6560" }}
        >
          <svg width="14" height="14" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
          Sign in with Microsoft
        </button>
        <button
          onClick={() => startGoogleScan(true)}
          className="text-xs font-medium transition-colors hover:text-[#1a1a1a] cursor-pointer py-2"
          style={{ color: "#a8a29e" }}
        >
          Google Workspace admin?
        </button>
      </div>

      {/* What the scan discovers */}
      <div className="mt-8 md:mt-12 grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: "Tech Stack Map", desc: "Every SaaS tool you use, auto-discovered from email" },
          { label: "Cost Estimation", desc: "Per-tool spend estimates using industry pricing data" },
          { label: "Duplicate Detection", desc: "Overlapping tools serving the same function" },
          { label: "Renewal Calendar", desc: "Upcoming renewals and renegotiation windows" },
          { label: "Shadow IT", desc: "Tools people are paying for that nobody approved" },
          { label: "Key Person Risk", desc: "Vendor relationships concentrated in one person" },
        ].map((item) => (
          <div key={item.label} className="p-3 md:p-4 rounded-lg" style={{ border: "1px solid #ddd8d0" }}>
            <p className="text-xs md:text-sm font-semibold mb-1">{item.label}</p>
            <p className="text-xs leading-relaxed" style={{ color: "#a8a29e" }}>{item.desc}</p>
          </div>
        ))}
      </div>

      {/* What happens after */}
      <div className="mt-8 md:mt-10 p-4 md:p-5 rounded-xl" style={{ border: "1px solid #ddd8d0", background: "linear-gradient(135deg, rgba(240,237,232,0.5) 0%, rgba(250,249,247,1) 100%)" }}>
        <p className="text-xs md:text-sm font-semibold mb-1 md:mb-2">What happens next</p>
        <p className="text-xs leading-relaxed" style={{ color: "#6b6560" }}>
          Your Command Center populates with everything we found. We sample recent emails, Drive metadata, and calendar events to discover your workflows, map your tech stack, and identify what&apos;s automatable. Gaps show exactly what to provide next to unlock deeper findings.
        </p>
      </div>

      {/* Trust signals */}
      <div className="mt-8 md:mt-10 flex items-center gap-4 md:gap-8 flex-wrap">
        {[
          { icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", label: "Read-only access" },
          { icon: "M3 11h18M3 11V6a2 2 0 012-2h14a2 2 0 012 2v5M3 11v5a2 2 0 002 2h14a2 2 0 002-2v-5", label: "Data never stored" },
          { icon: "M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83", label: "Results in minutes" },
        ].map((t) => (
          <div key={t.label} className="flex items-center gap-2">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={t.icon}/></svg>
            <span className="text-xs" style={{ color: "#6b6560" }}>{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── UPLOADING ─── */
function UploadingState({ fileName }: { fileName: string }) {
  return (
    <div className="animate-fade-up flex flex-col items-center justify-center py-32">
      <div className="w-12 h-12 rounded-full border-2 border-[#ddd8d0] border-t-[#c4501e] animate-spin" />
      <p className="mt-6 font-medium text-sm">Uploading {fileName}...</p>
    </div>
  );
}

/* ─── SCANNING VIEW ─── */
function ScanningView({ progress, findings, totalSavings, agentLog, scanSource, techStack, summary }: {
  progress: { records: number; scanned: number; message: string };
  findings: Finding[];
  totalSavings: number;
  agentLog: AgentLogEntry[];
  scanSource: string;
  techStack: TechStackApp[];
  summary: ScanSummary;
}) {
  const sourceLabel = scanSource === "google-admin" ? "Google Workspace" : scanSource === "google-personal" ? "Gmail" : "uploaded file";

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="font-fraunces text-2xl md:text-3xl font-light" style={{ letterSpacing: "-0.03em" }}>Agents scanning {sourceLabel}</h2>
          <p className="mt-2 text-xs md:text-sm" style={{ color: "#6b6560" }}>{progress.message || "Initializing scan..."}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#c4501e] animate-pulse-dot" />
          <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "#c4501e" }}>Live</span>
        </div>
      </div>

      {/* Progress */}
      {progress.records > 0 && (
        <div className="mt-6">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "#ddd8d0" }}>
            <div className="h-full rounded-full bg-[#c4501e] transition-all duration-1000 ease-out"
              style={{ width: `${Math.min((progress.scanned / progress.records) * 100, 95)}%` }} />
          </div>
          <div className="mt-3 flex items-center gap-6">
            <span className="text-xs tabular-nums" style={{ color: "#a8a29e" }}><b className="text-[#6b6560] font-semibold">{Math.min(Math.round((progress.scanned / Math.max(progress.records, 1)) * 100), 99)}%</b> complete</span>
            {findings.length > 0 && <span className="text-xs tabular-nums" style={{ color: "#a8a29e" }}><b className="text-[#6b6560] font-semibold">{findings.length}</b> findings</span>}
            {techStack.length > 0 && <span className="text-xs tabular-nums" style={{ color: "#a8a29e" }}><b className="text-[#6b6560] font-semibold">{techStack.length}</b> tools found</span>}
          </div>
        </div>
      )}

      {/* Discovered tools (during scan) */}
      {techStack.length > 0 && (
        <div className="mt-8 rounded-xl overflow-hidden" style={{ background: "#1a1a1a" }}>
          <div className="px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.4)" }}>
              Discovered {techStack.length} tools in your email
            </span>
          </div>
          <div className="px-5 py-4">
            <div className="flex flex-wrap gap-2">
              {techStack.slice(0, 25).map((app) => (
                <span key={app.name} className="text-xs px-2.5 py-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}>
                  {app.name}
                </span>
              ))}
              {techStack.length > 25 && (
                <span className="text-xs px-2.5 py-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.2)" }}>
                  +{techStack.length - 25} more
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Two-column: Agent log + Findings */}
      <div className="mt-6 grid md:grid-cols-5 gap-6">
        {/* Agent feed (left, narrower) */}
        <div className="md:col-span-2 rounded-xl overflow-hidden" style={{ background: "#1a1a1a" }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.4)" }}>Agent Feed</span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse-dot" />
              <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.25)" }}>LIVE</span>
            </div>
          </div>
          <div className="p-3 max-h-96 overflow-y-auto space-y-1">
            {agentLog.map((entry) => (
              <div key={entry.id} className="px-3 py-2 rounded-lg animate-fade-up" style={{ background: "rgba(255,255,255,0.03)", borderLeft: entry.type === "finding" ? "2px solid #c4501e" : "2px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: entry.type === "finding" ? "#c4501e" : entry.type === "discovery" ? "#4ade80" : "rgba(255,255,255,0.3)" }}>
                    {entry.agent}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: "rgba(255,255,255,0.15)" }}>{entry.timestamp}</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{entry.message}</p>
              </div>
            ))}
            {agentLog.length === 0 && (
              <div className="px-3 py-6 text-center">
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>Waiting for agent activity...</p>
              </div>
            )}
          </div>
        </div>

        {/* Findings (right, wider) */}
        <div className="md:col-span-3 space-y-3">
          {findings.length === 0 && (
            <div className="p-8 rounded-xl text-center" style={{ border: "1px solid #ddd8d0" }}>
              <p className="text-sm" style={{ color: "#a8a29e" }}>Findings will appear here as agents discover them...</p>
            </div>
          )}
          <FindingsList findings={findings} />
        </div>
      </div>
    </div>
  );
}

/* ─── DONE VIEW ─── */
function DoneView({ findings, agentLog, techStack, gaps, summary, renewals, automations, workflows, orgIntel, activeSection, setActiveSection, handleFile, onReset }: {
  findings: Finding[];
  agentLog: AgentLogEntry[];
  techStack: TechStackApp[];
  gaps: GapItem[];
  summary: ScanSummary;
  renewals: { vendor: string; renewalDate: string; estimatedCost: string; action: string; urgency: string }[];
  automations: { process: string; evidence: string; estimatedTimeSavings: string; recommendedTool: string; complexity: string }[];
  workflows: { name: string; type: string; description: string; frequency: string; participants: string[]; automationScore: number; agentBlueprint?: { trigger: string; steps: string[]; humanInTheLoop: string; complexity: string }; estimatedTimeSavings: string; estimatedAnnualSavings: string; evidence: string }[];
  orgIntel: OrgIntelligence | null;
  activeSection: "spend" | "workflows" | "waste" | null;
  setActiveSection: (s: "spend" | "workflows" | "waste" | null) => void;
  handleFile: (file: File) => void;
  onReset: () => void;
}) {
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const gapFileRef = useRef<HTMLInputElement>(null);
  const automatableWorkflows = workflows.filter(w => w.automationScore >= 70);

  return (
    <div className="animate-fade-up">
      {/* ════════════════════════════════════════ */}
      {/* THE REVEAL — credibility first           */}
      {/* ════════════════════════════════════════ */}

      <div className="text-center pt-4 md:pt-8">
        <p className="text-xs md:text-sm animate-fade-in reveal-1" style={{ color: "#a8a29e" }}>
          We analyzed {orgIntel ? `${orgIntel.emailsAnalyzed.toLocaleString()} emails, ${orgIntel.calendarEvents} calendar events, and ${orgIntel.driveDocuments} documents` : "your recent email, calendar, and drive data"}.
        </p>
      </div>

      {/* ════════════════════════════════════════ */}
      {/* THE HERO — org intelligence, not dollars */}
      {/* This is the "how do they know this?"     */}
      {/* moment. It's the thing they can verify.  */}
      {/* ════════════════════════════════════════ */}

      {/* Hero text — only when we have real data to show */}
      {(orgIntel || workflows.length > 0 || findings.length > 0) ? (
        <div className="mt-8 md:mt-10 mb-8 md:mb-10">
          <h2 className="font-fraunces text-2xl md:text-4xl font-light text-center animate-fade-in reveal-2" style={{ letterSpacing: "-0.03em" }}>
            Here&apos;s how your organization actually operates.
          </h2>
        </div>
      ) : (
        <div className="mt-8 md:mt-10 mb-8 md:mb-10 text-center">
          <h2 className="font-fraunces text-2xl md:text-3xl font-light animate-fade-in reveal-2" style={{ letterSpacing: "-0.03em" }}>
            We found {summary.appsDiscovered || techStack.length} tools in your email.
          </h2>
          <p className="mt-3 text-sm" style={{ color: "#6b6560" }}>
            This scan gave us a baseline. To see recurring processes, vendor relationships, and automation opportunities, we&apos;d need access to a work email with team communication.
          </p>
        </div>
      )}

      {orgIntel && (
        <div className="mb-10 rounded-2xl overflow-hidden animate-fade-in reveal-3" style={{ background: "#1a1a1a" }}>

          {/* Quick stats row — only show stats with real data */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ background: "rgba(255,255,255,0.06)" }}>
            {[
              { label: "People", value: orgIntel.orgSize, sub: orgIntel.orgDomain || "detected", show: orgIntel.orgSize > 0 },
              { label: "External partners", value: orgIntel.externalDomains, sub: orgIntel.externalMeetings > 0 ? `${orgIntel.externalMeetings} meetings` : "from email domains", show: orgIntel.externalDomains > 0 },
              { label: "Recurring processes", value: orgIntel.recurringProcesses.length, sub: "detected from email", show: orgIntel.recurringProcesses.length > 0 },
              { label: "Meeting load", value: `${Math.round(orgIntel.meetingHours6mo / 26)}h/wk`, sub: `${orgIntel.recurringMeetings} recurring`, show: orgIntel.meetingHours6mo > 0 },
              { label: "Email threads", value: orgIntel.emailsAnalyzed, sub: `${orgIntel.deepThreads} deep threads`, show: orgIntel.recurringProcesses.length === 0 && orgIntel.meetingHours6mo === 0 && orgIntel.emailsAnalyzed > 0 },
            ].filter((s) => s.show).slice(0, 4).map((stat) => (
              <div key={stat.label} className="p-4" style={{ background: "#1a1a1a" }}>
                <p className="text-xs uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>{stat.label}</p>
                <p className="mt-1 font-fraunces text-xl font-light" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.03em" }}>{stat.value}</p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>{stat.sub}</p>
              </div>
            ))}
          </div>

          {/* Recurring processes — the magic */}
          {orgIntel.recurringProcesses.length > 0 && (
            <div className="px-5 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#10b981" }}>
                Recurring processes we detected
              </p>
              <div className="space-y-2">
                {orgIntel.recurringProcesses.slice(0, 6).map((p, i) => (
                  <div key={i} className="flex items-start gap-3 px-3 py-2.5 rounded-lg" style={{ background: "rgba(255,255,255,0.03)" }}>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded mt-0.5 flex-shrink-0" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>{p.frequency}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: "rgba(255,255,255,0.7)" }}>{p.pattern}</p>
                      <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {p.sender.split("@")[0]} sends this {p.frequency}{p.dayOfWeek !== "Sunday" ? ` (usually ${p.dayOfWeek}s)` : ""} to {p.recipients} {p.recipients === 1 ? "person" : "people"} — {p.occurrences} times in 6 months
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vendor relationships from calendar */}
          {orgIntel.topVendorMeetings.length > 0 && (
            <div className="px-5 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#3b82f6" }}>
                Vendor relationships (from calendar)
              </p>
              <div className="flex flex-wrap gap-2">
                {orgIntel.topVendorMeetings.map((v) => (
                  <span key={v.domain} className="text-xs px-2.5 py-1.5 rounded-full" style={{ background: "rgba(59,130,246,0.1)", color: "rgba(59,130,246,0.8)" }}>
                    {v.domain} <span style={{ opacity: 0.5 }}>{v.meetings} meetings</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Key people + risk signals */}
          {(orgIntel.topCommunicators.length > 0 || orgIntel.humanMiddleware.length > 0) && (
            <div className="px-5 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="grid md:grid-cols-2 gap-4">
                {orgIntel.topCommunicators.length > 0 && (() => {
                  const totalEmails = orgIntel.topCommunicators.reduce((s, c) => s + c.total, 0);
                  const topPerson = orgIntel.topCommunicators[0];
                  const topPct = totalEmails > 0 ? Math.round((topPerson.total / totalEmails) * 100) : 0;
                  return (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: topPct > 60 ? "#f59e0b" : "rgba(255,255,255,0.3)" }}>
                        {topPct > 60 ? "Communication bottleneck" : "Communication distribution"}
                      </p>
                      {topPct > 60 && (
                        <p className="text-xs mb-2" style={{ color: "rgba(255,255,255,0.25)" }}>
                          {topPerson.email.split("@")[0]} handles {topPct}% of all email. If they&apos;re unavailable, communication stalls.
                        </p>
                      )}
                      {orgIntel.topCommunicators.slice(0, 4).map((c) => {
                        const pct = totalEmails > 0 ? Math.round((c.total / totalEmails) * 100) : 0;
                        return (
                          <div key={c.email} className="flex items-center justify-between py-1.5">
                            <span className="text-xs truncate" style={{ color: "rgba(255,255,255,0.5)" }}>{c.email.split("@")[0]}</span>
                            <span className="text-xs tabular-nums flex-shrink-0 ml-2" style={{ color: pct > 50 ? "#f59e0b" : "rgba(255,255,255,0.25)" }}>{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {orgIntel.humanMiddleware.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#f59e0b" }}>Information routers</p>
                    <p className="text-xs mb-2" style={{ color: "rgba(255,255,255,0.25)" }}>People who mostly forward rather than originate email. These roles may be partially automatable.</p>
                    {orgIntel.humanMiddleware.map((h) => (
                      <div key={h.email} className="flex items-center justify-between py-1.5">
                        <span className="text-xs truncate" style={{ color: "rgba(255,255,255,0.5)" }}>{h.email.split("@")[0]}</span>
                        <span className="text-xs tabular-nums flex-shrink-0 ml-2" style={{ color: "#f59e0b" }}>{h.forwardRatio}% forwarded</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Video tools + shared spreadsheets */}
          <div className="px-5 py-4 flex flex-wrap gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            {orgIntel.videoTools.length > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>
                Video: {orgIntel.videoTools.join(", ")}
              </span>
            )}
            {orgIntel.sharedSpreadsheets > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>
                {orgIntel.sharedSpreadsheets} shared spreadsheets (manual data exchange)
              </span>
            )}
            {orgIntel.deepThreads > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>
                {orgIntel.deepThreads} deep email threads (5+ replies)
              </span>
            )}
            {orgIntel.attachmentThreads > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>
                {orgIntel.attachmentThreads} threads with repeated attachments
              </span>
            )}
            {orgIntel.roleInboxes && orgIntel.roleInboxes.length > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "rgba(59,130,246,0.1)", color: "rgba(59,130,246,0.7)" }}>
                Role inboxes: {[...new Set(orgIntel.roleInboxes.map((r) => r.split("@")[0]))].join(", ")}
              </span>
            )}
            {orgIntel.gmailLabels && orgIntel.gmailLabels.length > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>
                {orgIntel.gmailLabels.length} custom labels
              </span>
            )}
          </div>
        </div>
      )}

      {/* No orgIntel fallback — still show something useful */}
      {!orgIntel && (
        <div className="mb-10 p-6 rounded-2xl text-center" style={{ background: "#f0ede8" }}>
          <p className="text-sm font-medium" style={{ color: "#6b6560" }}>
            We found <b className="text-[#1a1a1a]">{summary.appsDiscovered || techStack.length} tools</b> in your email
            {workflows.length > 0 && <> and <b className="text-[#1a1a1a]">{workflows.length} recurring processes</b></>}.
          </p>
        </div>
      )}

      {/* ════════════════════════════════════════ */}
      {/* TOP ACTIONS — the "what to do" block    */}
      {/* ════════════════════════════════════════ */}
      {(findings.length > 0 || automatableWorkflows.length > 0) && (
        <div className="mb-10">
          <h3 className="font-fraunces text-xl font-light mb-4" style={{ letterSpacing: "-0.02em" }}>
            Your top actions
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Top spend/waste finding (prefer critical/high, fall back to any) */}
            {(findings.filter((f) => f.severity === "critical" || f.severity === "high").slice(0, 1).length > 0
              ? findings.filter((f) => f.severity === "critical" || f.severity === "high").slice(0, 1)
              : findings.slice(0, 1)
            ).map((f) => (
              <div key={f.id} className="p-4 rounded-xl" style={{ border: "2px solid #c4501e", background: "rgba(196,80,30,0.03)" }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#c4501e" }}>Fix first</p>
                <h4 className="text-sm font-semibold mb-1">{f.title}</h4>
                <p className="text-xs leading-relaxed" style={{ color: "#6b6560" }}>{f.description?.slice(0, 120)}{(f.description?.length || 0) > 120 ? "..." : ""}</p>
                {f.amount && <p className="mt-2 text-sm font-semibold" style={{ color: "#c4501e" }}>{f.amount}</p>}
              </div>
            ))}
            {/* Top automatable workflow */}
            {automatableWorkflows.slice(0, 1).map((w, i) => (
              <div key={i} className="p-4 rounded-xl" style={{ border: "2px solid #10b981", background: "rgba(16,185,129,0.03)" }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#10b981" }}>Automate this</p>
                <h4 className="text-sm font-semibold mb-1">{w.name}</h4>
                <p className="text-xs leading-relaxed" style={{ color: "#6b6560" }}>{w.description?.slice(0, 120)}{(w.description?.length || 0) > 120 ? "..." : ""}</p>
                {w.estimatedTimeSavings && <p className="mt-2 text-sm font-semibold" style={{ color: "#10b981" }}>{w.estimatedTimeSavings} saved</p>}
              </div>
            ))}
            {/* Key risk / operational insight */}
            {findings.filter((f) => f.category === "Risk" || f.category === "Knowledge" || f.category === "Operations").slice(0, 1).map((f) => (
              <div key={f.id} className="p-4 rounded-xl" style={{ border: "2px solid #f59e0b", background: "rgba(245,158,11,0.03)" }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#f59e0b" }}>Watch out</p>
                <h4 className="text-sm font-semibold mb-1">{f.title}</h4>
                <p className="text-xs leading-relaxed" style={{ color: "#6b6560" }}>{f.description?.slice(0, 120)}{(f.description?.length || 0) > 120 ? "..." : ""}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════ */}
      {/* WORKFLOWS — the automatable stuff       */}
      {/* This is shown inline, not behind a      */}
      {/* click. If we found workflows, show them. */}
      {/* ════════════════════════════════════════ */}
      {workflows.length > 0 && (
        <div className="mb-8">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="font-fraunces text-xl font-light" style={{ letterSpacing: "-0.02em" }}>
              {automatableWorkflows.length > 0
                ? <>{automatableWorkflows.length} workflows an AI agent could run for you</>
                : <>{workflows.length} recurring processes we detected</>
              }
            </h3>
          </div>
          <div className="space-y-3">
            {workflows.slice(0, 5).map((w, i) => (
              <div key={i} className="p-4 rounded-xl" style={{ border: "1px solid #ddd8d0" }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: w.automationScore >= 70 ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)", color: w.automationScore >= 70 ? "#10b981" : "#f59e0b" }}>
                        {w.automationScore >= 70 ? "automatable" : "review"}
                      </span>
                      <span className="text-xs uppercase tracking-wider" style={{ color: "#a8a29e" }}>{w.frequency}</span>
                    </div>
                    <h4 className="text-sm font-semibold mb-1">{w.name}</h4>
                    <p className="text-sm leading-relaxed" style={{ color: "#6b6560" }}>{w.description}</p>
                    {w.evidence && (
                      <p className="mt-2 text-xs italic" style={{ color: "#a8a29e" }}>Evidence: {w.evidence}</p>
                    )}
                    {w.agentBlueprint && Array.isArray(w.agentBlueprint.steps) && (
                      <div className="mt-3 p-3 rounded-lg" style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.1)" }}>
                        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#10b981" }}>What an AI agent would do instead</p>
                        {w.agentBlueprint.trigger && <p className="text-xs mb-1" style={{ color: "#6b6560" }}>Trigger: {w.agentBlueprint.trigger}</p>}
                        <ol className="text-xs list-decimal pl-4 space-y-0.5" style={{ color: "#6b6560" }}>
                          {w.agentBlueprint.steps.map((step: string, j: number) => <li key={j}>{step}</li>)}
                        </ol>
                        {w.agentBlueprint.humanInTheLoop && (
                          <p className="text-xs mt-1" style={{ color: "#f59e0b" }}>Human stays in loop: {w.agentBlueprint.humanInTheLoop}</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {w.estimatedTimeSavings && <p className="text-xs font-semibold" style={{ color: "#10b981" }}>{w.estimatedTimeSavings}</p>}
                    <p className="text-xs" style={{ color: "#a8a29e" }}>saved</p>
                  </div>
                </div>
              </div>
            ))}
            {workflows.length > 5 && (
              <button
                onClick={() => setActiveSection(activeSection === "workflows" ? null : "workflows")}
                className="w-full text-center text-xs font-medium py-3 rounded-xl transition-all hover:bg-[#f0ede8]"
                style={{ border: "1px solid #ddd8d0", color: "#6b6560" }}
              >
                {activeSection === "workflows" ? "Show less" : `Show all ${workflows.length} workflows`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Remaining workflows (if "show all" clicked) */}
      {activeSection === "workflows" && workflows.length > 5 && (
        <div className="mb-8 space-y-3">
          {workflows.slice(5).map((w, i) => (
            <div key={i + 5} className="p-4 rounded-xl" style={{ border: "1px solid #ddd8d0" }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: w.automationScore >= 70 ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)", color: w.automationScore >= 70 ? "#10b981" : "#f59e0b" }}>
                      {w.automationScore >= 70 ? "automatable" : "review"} — {w.frequency}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold mb-1">{w.name}</h4>
                  <p className="text-sm leading-relaxed" style={{ color: "#6b6560" }}>{w.description}</p>
                </div>
                {w.estimatedTimeSavings && <p className="text-xs font-semibold flex-shrink-0" style={{ color: "#10b981" }}>{w.estimatedTimeSavings}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════ */}
      {/* SECONDARY: Findings + Tech Stack        */}
      {/* Dollars only when backed by evidence    */}
      {/* ════════════════════════════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 mb-8">
        {([
          { key: "spend" as const, label: "TECH STACK", value: `${summary.appsDiscovered || techStack.length} tools`, sub: summary.totalAnnualSpend ? `${summary.totalAnnualSpend} estimated` : "detected from email", color: "#3b82f6" },
          { key: "waste" as const, label: "FINDINGS", value: `${findings.length} issues`, sub: (criticalCount + highCount > 0) ? `${criticalCount} critical, ${highCount} high` : "from AI analysis", color: "#c4501e" },
        ]).map((pillar) => (
          <button
            key={pillar.key}
            onClick={() => setActiveSection(activeSection === pillar.key ? null : pillar.key)}
            className={`text-left p-4 md:p-5 rounded-xl transition-all cursor-pointer hover:-translate-y-0.5 ${activeSection === pillar.key ? "shadow-lg -translate-y-0.5" : ""}`}
            style={{ border: `2px solid ${activeSection === pillar.key ? pillar.color : "#ddd8d0"}`, background: activeSection === pillar.key ? `${pillar.color}08` : "transparent" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: pillar.color }}>{pillar.label}</p>
            <p className="font-fraunces text-xl md:text-2xl font-light" style={{ letterSpacing: "-0.03em" }}>{pillar.value}</p>
            <p className="text-xs mt-1" style={{ color: "#a8a29e" }}>{pillar.sub}</p>
          </button>
        ))}
      </div>

      {/* FOCUSED SECTIONS - appear when pillar is clicked */}

      {/* SPEND section */}
      {activeSection === "spend" && techStack.length > 0 && (
        <div className="mb-8 animate-fade-up rounded-xl overflow-hidden" style={{ border: "2px solid #3b82f6" }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ background: "rgba(59,130,246,0.04)", borderBottom: "1px solid rgba(59,130,246,0.1)" }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#3b82f6" }}>Tech Stack Map</span>
            <button onClick={() => setActiveSection(null)} className="text-xs" style={{ color: "#a8a29e" }}>Close</button>
          </div>
          <div className="p-5">
            {summary.spendByCategory && Object.keys(summary.spendByCategory).length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
                {Object.entries(summary.spendByCategory).map(([cat, amount]) => (
                  <div key={cat} className="flex items-baseline justify-between px-3 py-2.5 rounded-lg" style={{ background: "#f0ede8" }}>
                    <span className="text-xs font-medium">{cat}</span>
                    <span className="text-xs font-semibold tabular-nums">{amount}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {techStack.map((app) => (
                <span key={app.name} className="text-xs px-3 py-1.5 rounded-full" style={{ background: "#f0ede8", color: "#1a1a1a" }}>
                  {app.name} <span style={{ color: "#a8a29e" }}>{app.estimatedCost}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* WORKFLOWS section */}
      {/* WASTE section */}
      {activeSection === "waste" && findings.length > 0 && (
        <div className="mb-8 animate-fade-up rounded-xl overflow-hidden" style={{ border: "2px solid #c4501e" }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ background: "rgba(196,80,30,0.04)", borderBottom: "1px solid rgba(196,80,30,0.1)" }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#c4501e" }}>Waste Findings</span>
            <button onClick={() => setActiveSection(null)} className="text-xs" style={{ color: "#a8a29e" }}>Close</button>
          </div>
          <div className="p-4 space-y-3">
            <FindingsList findings={findings} />
          </div>
        </div>
      )}

      {/* Tech stack strip (compact) */}
      {techStack.length > 0 && (
        <div className="mb-8 p-4 rounded-xl" style={{ border: "1px solid #ddd8d0" }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#a8a29e" }}>
            Detected in your email ({techStack.length} tools)
          </p>
          <div className="flex flex-wrap gap-2">
            {techStack.slice(0, 20).map((app) => (
              <span key={app.name} className="text-xs px-2.5 py-1.5 rounded-full" style={{ background: "#f0ede8", color: "#1a1a1a" }}>
                {app.name}
              </span>
            ))}
            {techStack.length > 20 && (
              <span className="text-xs px-2.5 py-1.5 rounded-full" style={{ background: "#f0ede8", color: "#a8a29e" }}>+{techStack.length - 20} more</span>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════ */}
      {/* THE HOOK — gap wizard as game levels    */}
      {/* ════════════════════════════════════════ */}
      {gaps.length > 0 && (
        <div className="mt-10 md:mt-16" id="gaps">
          {/* The emotional hook */}
          <div className="text-center mb-8 md:mb-10">
            <h3 className="font-fraunces text-2xl md:text-3xl font-light" style={{ letterSpacing: "-0.03em" }}>
              We discovered all of this from your email alone.
            </h3>
            <p className="mt-3 text-sm md:text-base" style={{ color: "#6b6560" }}>
              Imagine what we&apos;d find with access to your actual systems.
            </p>
          </div>

          {/* Coverage as game progress */}
          <div className="mb-8 p-5 md:p-6 rounded-2xl" style={{ background: "#1a1a1a" }}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>Assessment Progress</span>
              <span className="font-fraunces text-2xl font-light tabular-nums" style={{ color: "rgba(255,255,255,0.9)" }}>{summary.coverageScore || 35}%</span>
            </div>
            <div className="h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div className="h-full rounded-full coverage-fill" style={{ width: `${summary.coverageScore || 35}%`, background: "linear-gradient(90deg, #c4501e 0%, #f59e0b 50%, #10b981 100%)" }} />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Each unlock below fills more of your Command Center</p>
              <p className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>{gaps.length} levels remaining</p>
            </div>
          </div>

          {/* Personalized gap steps */}
          <div className="space-y-4">
            {gaps.map((gap, i) => {
              const isDesktop = gap.type === "desktop_scan" || gap.icon === "desktop";
              const isUpload = gap.type === "upload_data" || gap.icon === "upload";
              const isConnect = gap.type === "connect_app";
              const coverageGain = (gap.coverageAfter || 0) - (gap.coverageBefore || 0);

              return (
                <div
                  key={gap.title || i}
                  className="group rounded-xl overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg"
                  style={{ border: "1px solid #ddd8d0" }}
                >
                  <div className="flex items-stretch">
                    {/* Step number + priority bar */}
                    <div className="w-16 flex-shrink-0 flex flex-col items-center justify-center" style={{ background: i === 0 ? "rgba(196,80,30,0.06)" : i === 1 ? "rgba(245,158,11,0.04)" : "rgba(168,162,158,0.04)" }}>
                      <span className="text-2xl font-fraunces font-light" style={{ color: i === 0 ? "#c4501e" : i === 1 ? "#f59e0b" : "#a8a29e", letterSpacing: "-0.03em" }}>{i + 1}</span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-sm font-semibold">{gap.title}</h4>
                            {coverageGain > 0 && (
                              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(16,185,129,0.08)", color: "#10b981" }}>+{coverageGain}% coverage</span>
                            )}
                          </div>
                          <p className="text-sm leading-relaxed" style={{ color: "#6b6560" }}>{gap.description}</p>

                          {/* How to provide */}
                          {gap.howToProvide && (
                            <div className="mt-3 p-3 rounded-lg text-xs leading-relaxed" style={{ background: "#f0ede8", color: "#6b6560" }}>
                              {gap.howToProvide}
                            </div>
                          )}

                          {/* What it unlocks */}
                          {gap.unlocks && gap.unlocks.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {gap.unlocks.map((u: string) => (
                                <span key={u} className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(59,130,246,0.06)", color: "#3b82f6" }}>{u}</span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Expected value + action */}
                        <div className="flex-shrink-0 text-right">
                          {gap.expectedValue && (
                            <p className="font-fraunces text-lg font-light" style={{ color: "#c4501e", letterSpacing: "-0.02em" }}>{gap.expectedValue}</p>
                          )}
                          {gap.expectedFindings && gap.expectedFindings > 0 && (
                            <p className="text-xs" style={{ color: "#a8a29e" }}>~{gap.expectedFindings} findings</p>
                          )}
                        </div>
                      </div>

                      {/* Action button */}
                      <div className="mt-4 flex items-center gap-3">
                        {isDesktop ? (
                          <a href="mailto:scotty@upskillerai.com?subject=Desktop%20scan%20access%20request" className="text-sm font-semibold px-5 py-2.5 rounded-full bg-[#1a1a1a] text-[#faf9f7] hover:bg-[#333] transition-all inline-flex items-center gap-2">
                            Request Desktop Access
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }}>Beta</span>
                          </a>
                        ) : isUpload ? (
                          <button
                            onClick={() => { gapFileRef.current?.click(); }}
                            className="text-sm font-semibold px-5 py-2.5 rounded-full transition-all cursor-pointer hover:bg-[#f0ede8]"
                            style={{ border: "1px solid #ddd8d0" }}
                          >
                            Upload {gap.appName || "data"}
                          </button>
                        ) : isConnect ? (
                          <a href={`mailto:scotty@upskillerai.com?subject=Connect%20${encodeURIComponent(gap.appName || "app")}%20request&body=I%20want%20to%20connect%20${encodeURIComponent(gap.appName || "my app")}%20for%20deeper%20scanning.`} className="text-sm font-semibold px-5 py-2.5 rounded-full bg-[#1a1a1a] text-[#faf9f7] hover:bg-[#333] transition-all inline-flex items-center gap-2">
                            Connect {gap.appName}
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }}>Beta</span>
                          </a>
                        ) : (
                          <button
                            onClick={() => { gapFileRef.current?.click(); }}
                            className="text-sm font-semibold px-5 py-2.5 rounded-full transition-all cursor-pointer hover:bg-[#f0ede8]"
                            style={{ border: "1px solid #ddd8d0" }}
                          >
                            Provide this data
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <input
            ref={gapFileRef}
            type="file"
            className="hidden"
            accept=".csv,.xlsx,.xls,.json,.tsv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>
      )}

      {/* Renewal Calendar */}
      {renewals.length > 0 && (
        <div className="mt-8">
          <h3 className="font-fraunces text-xl font-light mb-4" style={{ letterSpacing: "-0.02em" }}>Renewal Calendar</h3>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #ddd8d0" }}>
            <div className="hidden md:grid grid-cols-4 gap-0 px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ background: "#f0ede8", color: "#a8a29e" }}>
              <span>Vendor</span><span>Renewal Date</span><span>Est. Cost</span><span>Action</span>
            </div>
            {renewals.map((r, i) => (
              <div key={i} className="px-5 py-3 flex flex-wrap md:grid md:grid-cols-4 gap-1 md:gap-0 items-center" style={{ borderTop: "1px solid #ddd8d0" }}>
                <span className="text-sm font-medium w-full md:w-auto">{r.vendor}</span>
                <span className="text-xs md:text-sm tabular-nums" style={{ color: "#6b6560" }}>{r.renewalDate}</span>
                <span className="text-xs md:text-sm font-medium tabular-nums ml-2 md:ml-0">{r.estimatedCost}</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full inline-block w-fit ml-auto md:ml-0" style={{
                  background: r.urgency === "urgent" ? "rgba(196,80,30,0.08)" : r.urgency === "upcoming" ? "rgba(245,158,11,0.08)" : "rgba(59,130,246,0.08)",
                  color: r.urgency === "urgent" ? "#c4501e" : r.urgency === "upcoming" ? "#f59e0b" : "#3b82f6"
                }}>{r.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Automation Opportunities */}
      {automations.length > 0 && (
        <div className="mt-8">
          <h3 className="font-fraunces text-xl font-light mb-4" style={{ letterSpacing: "-0.02em" }}>Workflow Automation Opportunities</h3>
          <div className="space-y-3">
            {automations.map((a, i) => (
              <div key={i} className="p-5 rounded-xl" style={{ border: "1px solid #ddd8d0" }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{
                        background: a.complexity === "low" ? "rgba(16,185,129,0.08)" : a.complexity === "medium" ? "rgba(245,158,11,0.08)" : "rgba(196,80,30,0.08)",
                        color: a.complexity === "low" ? "#10b981" : a.complexity === "medium" ? "#f59e0b" : "#c4501e"
                      }}>{a.complexity} effort</span>
                      <span className="text-xs font-semibold" style={{ color: "#10b981" }}>{a.estimatedTimeSavings} saved</span>
                    </div>
                    <h4 className="text-sm font-semibold mb-1">{a.process}</h4>
                    <p className="text-sm leading-relaxed" style={{ color: "#6b6560" }}>{a.evidence}</p>
                    {a.recommendedTool && (
                      <p className="mt-2 text-xs" style={{ color: "#3b82f6" }}>Recommended: {a.recommendedTool}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Findings + Agent Log */}
      <div className="mt-8 grid md:grid-cols-5 gap-6">
        <div className="md:col-span-2 rounded-xl overflow-hidden" style={{ background: "#1a1a1a" }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.4)" }}>Agent Log</span>
            <span className="text-xs tabular-nums" style={{ color: "rgba(255,255,255,0.2)" }}>{agentLog.length} events</span>
          </div>
          <div className="p-3 max-h-96 overflow-y-auto space-y-1">
            {agentLog.map((entry) => (
              <div key={entry.id} className="px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", borderLeft: entry.type === "finding" ? "2px solid #c4501e" : "2px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: entry.type === "finding" ? "#c4501e" : "rgba(255,255,255,0.3)" }}>{entry.agent}</span>
                  <span className="text-xs tabular-nums" style={{ color: "rgba(255,255,255,0.15)" }}>{entry.timestamp}</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{entry.message}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-3 space-y-3">
          <FindingsList findings={findings} />
        </div>
      </div>

      {/* CLOSING CTA */}
      <div className="mt-12 md:mt-16 p-6 md:p-10 rounded-2xl text-center" style={{ background: "#1a1a1a" }}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "rgba(255,255,255,0.3)" }}>This was from email alone</p>
        <h3 className="font-fraunces text-xl md:text-2xl font-light text-white/90 max-w-lg mx-auto" style={{ letterSpacing: "-0.02em" }}>
          {workflows.length > 0
            ? <>{workflows.length} processes, {summary.appsDiscovered || techStack.length} tools, and {findings.length} findings from {summary.coverageScore || 35}% visibility.</>
            : <>{summary.appsDiscovered || techStack.length} tools and {findings.length} findings from {summary.coverageScore || 35}% visibility.</>
          }
          <br />
          <span style={{ color: "#f59e0b" }}>Imagine what we&apos;d find connected to everything.</span>
        </h3>
        <p className="mt-4 text-sm text-white/40 max-w-md mx-auto leading-relaxed">
          Two-week engagement. Fixed fee. We connect to all your systems, run continuously, and map every workflow, every vendor relationship, every dollar.
        </p>
        <a href={`mailto:scotty@upskillerai.com?subject=Full%20engagement%20—%20scanner%20found%20${encodeURIComponent((workflows.length || 0) + ' workflows and ' + (findings.length || 0) + ' findings')}`} className="mt-6 inline-flex text-sm font-semibold px-7 py-3 rounded-full bg-[#faf9f7] text-[#1a1a1a] hover:bg-[#eee] transition-all hover:-translate-y-0.5 hover:shadow-lg">
          Schedule a walkthrough
        </a>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-3 mt-6">
        <button onClick={onReset} className="text-xs font-medium px-4 py-2 rounded-full transition-all hover:bg-[#f0ede8]" style={{ border: "1px solid #ddd8d0", color: "#6b6560" }}>New scan</button>
      </div>
    </div>
  );
}

/* ─── SHARED COMPONENTS ─── */
function FindingsList({ findings }: { findings: Finding[] }) {
  const colors: Record<string, { bg: string; text: string }> = {
    critical: { bg: "rgba(196,80,30,0.08)", text: "#c4501e" },
    high: { bg: "rgba(245,158,11,0.08)", text: "#f59e0b" },
    medium: { bg: "rgba(59,130,246,0.08)", text: "#3b82f6" },
    low: { bg: "rgba(168,162,158,0.08)", text: "#a8a29e" },
  };
  const defaultColor = { bg: "rgba(168,162,158,0.08)", text: "#a8a29e" };
  const agentColors: Record<string, string> = {
    Ledger: "#60a5fa", Quartermaster: "#f59e0b", Chief: "#c4501e",
    Scout: "#4ade80", Signal: "#a78bfa", Atlas: "#f0abfc",
  };
  const tvColors: Record<string, { bg: string; text: string }> = {
    immediate: { bg: "rgba(16,185,129,0.08)", text: "#10b981" },
    "30 days": { bg: "rgba(59,130,246,0.08)", text: "#3b82f6" },
    "90 days": { bg: "rgba(245,158,11,0.08)", text: "#f59e0b" },
    "6 months": { bg: "rgba(168,162,158,0.08)", text: "#a8a29e" },
  };
  return (
    <>
      {findings.map((f, i) => (
        <div key={f.id} className="p-5 rounded-lg animate-fade-up" style={{ border: "1px solid #ddd8d0", animationDelay: `${i * 0.04}s` }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: (colors[f.severity] || defaultColor).bg, color: (colors[f.severity] || defaultColor).text }}>{f.severity}</span>
                <span className="text-xs uppercase tracking-wider font-medium" style={{ color: "#a8a29e" }}>{f.category}</span>
                {f.agent && (
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: agentColors[f.agent] || "#a8a29e" }}>{f.agent}</span>
                )}
                {f.timeToValue && tvColors[f.timeToValue] && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ background: tvColors[f.timeToValue].bg, color: tvColors[f.timeToValue].text }}>{f.timeToValue}</span>
                )}
              </div>
              <h4 className="mt-2 text-sm font-semibold">{f.title}</h4>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: "#6b6560" }}>{f.description}</p>
              {f.recommendation && (
                <div className="mt-3 p-3 rounded-lg" style={{ background: "#f0ede8" }}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#a8a29e" }}>Recommended action</p>
                  <p className="text-sm leading-relaxed" style={{ color: "#1a1a1a" }}>{f.recommendation}</p>
                </div>
              )}
              {f.department && (
                <p className="mt-2 text-xs" style={{ color: "#a8a29e" }}>Dept: {f.department}</p>
              )}
            </div>
            {f.amount && (
              <div className="text-right flex-shrink-0">
                <p className="font-fraunces text-xl font-light" style={{ color: "#c4501e", letterSpacing: "-0.02em" }}>{f.amount}</p>
                <p className="text-xs" style={{ color: "#a8a29e" }}>/year</p>
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

function Footer() {
  return (
    <footer className="mt-16 px-6 md:px-18 py-8 flex justify-between items-center" style={{ borderTop: "1px solid #ddd8d0" }}>
      <span className="text-xs" style={{ color: "#a8a29e" }}>&copy; 2026 UpSkiller AI</span>
      <div className="flex gap-5">
        <a href="https://upskillerai.com" className="text-xs hover:text-[#1a1a1a] transition-colors" style={{ color: "#a8a29e" }}>Home</a>
        <a href="/privacy" className="text-xs hover:text-[#1a1a1a] transition-colors" style={{ color: "#a8a29e" }}>Privacy</a>
        <a href="/terms" className="text-xs hover:text-[#1a1a1a] transition-colors" style={{ color: "#a8a29e" }}>Terms</a>
        <a href="mailto:scotty@upskillerai.com" className="text-xs hover:text-[#1a1a1a] transition-colors" style={{ color: "#a8a29e" }}>Contact</a>
      </div>
    </footer>
  );
}
