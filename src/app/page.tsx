"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// Count-up animation hook
function useCountUp(target: number, duration = 1500, delay = 2000) {
  const [value, setValue] = useState(0);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  useEffect(() => {
    if (!started || target === 0) return;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValue(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [started, target, duration]);
  return value;
}

// Parse dollar string to number: "$2.3M" → 2300, "$340K" → 340
function parseDollarAmount(s: string): { num: number; suffix: string } {
  if (!s) return { num: 0, suffix: "" };
  const cleaned = s.replace(/[^0-9.KMBkmb]/g, "");
  const numPart = parseFloat(cleaned) || 0;
  if (s.toUpperCase().includes("M")) return { num: numPart * 1000, suffix: "M" };
  if (s.toUpperCase().includes("B")) return { num: numPart * 1000000, suffix: "B" };
  return { num: numPart, suffix: "K" };
}

function CountUpDollar({ value, className, style }: { value: string; className?: string; style?: React.CSSProperties }) {
  const parsed = parseDollarAmount(value);
  const animated = useCountUp(parsed.num, 1800, 2000);
  const display = parsed.suffix === "M" ? `$${(animated / 1000).toFixed(1)}M` :
    parsed.suffix === "B" ? `$${(animated / 1000000).toFixed(1)}B` :
    `$${animated.toLocaleString()}K`;
  return <span className={className} style={style}>{display}</span>;
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

type ScanMode = "choose" | "uploading" | "scanning" | "done";

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

export default function Home() {
  const [mode, setMode] = useState<ScanMode>("choose");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);
  const [scanProgress, setScanProgress] = useState({ records: 0, scanned: 0, message: "" });
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const [totalSavings, setTotalSavings] = useState(0);
  const [scanSource, setScanSource] = useState<"file" | "google-admin" | "google-personal">("file");
  const [techStack, setTechStack] = useState<TechStackApp[]>([]);
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [summary, setSummary] = useState<ScanSummary>({});
  const [renewals, setRenewals] = useState<{ vendor: string; renewalDate: string; estimatedCost: string; action: string; urgency: string }[]>([]);
  const [automations, setAutomations] = useState<{ process: string; evidence: string; estimatedTimeSavings: string; recommendedTool: string; complexity: string }[]>([]);
  const [workflows, setWorkflows] = useState<{ name: string; type: string; description: string; frequency: string; participants: string[]; automationScore: number; agentBlueprint?: { trigger: string; steps: string[]; humanInTheLoop: string; complexity: string }; estimatedTimeSavings: string; estimatedAnnualSavings: string; evidence: string }[]>([]);
  const [activeSection, setActiveSection] = useState<"spend" | "workflows" | "waste" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setAgentLog([]);

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
            if (event.type === "progress") {
              setScanProgress(event);
              if (event.message) addAgentLog("Scout", event.message, "progress");
            } else if (event.type === "finding") {
              findingId++;
              const finding: Finding = { id: findingId, ...event };
              setFindings((prev) => [...prev, finding]);
              addAgentLog("Ledger", `${event.title}${event.amount ? " — " + event.amount : ""}`, "finding");
              if (event.amount) {
                const num = parseInt(event.amount.replace(/[^0-9]/g, ""));
                if (!isNaN(num)) setTotalSavings((prev) => prev + num);
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      setMode("choose");
    }
  }, [addAgentLog]);

  const startGoogleScan = useCallback(async (adminMode: boolean) => {
    setScanSource(adminMode ? "google-admin" : "google-personal");
    setMode("scanning");
    setFindings([]);
    setTotalSavings(0);
    setAgentLog([]);
    setTechStack([]);
    setGaps([]);
    setSummary({});

    addAgentLog("Dispatch", adminMode ? "Initiating full org scan via Google Workspace..." : "Initiating personal account scan via Gmail...", "progress");

    try {
      const scopes = adminMode
        ? "admin-directory-readonly,gmail-readonly,drive-readonly"
        : "gmail-readonly";
      const res = await fetch(`/api/scan-google?mode=${adminMode ? "admin" : "personal"}&scopes=${scopes}`, { method: "POST" });
      if (!res.ok) {
        // If 401, redirect to Google OAuth
        if (res.status === 401) {
          const { authUrl } = await res.json();
          window.location.href = authUrl;
          return;
        }
        throw new Error("Scan failed");
      }

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
            if (event.type === "agent-log") {
              addAgentLog(event.agent, event.message, event.logType || "progress");
            } else if (event.type === "progress") {
              setScanProgress(event);
            } else if (event.type === "techStack") {
              setTechStack(event.apps || []);
              setSummary((prev) => ({ ...prev, totalAnnualSpend: event.totalEstimatedSpend, appsDiscovered: event.appCount }));
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
                const num = parseInt(event.amount.replace(/[^0-9]/g, ""));
                if (!isNaN(num)) setTotalSavings((prev) => prev + num);
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      setMode("choose");
    }
  }, [addAgentLog]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  }, []);

  // Check for OAuth callback OR load saved results
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("scan") === "ready") {
      const adminMode = params.get("mode") === "admin";
      window.history.replaceState({}, "", "/");
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
          setTechStack(s.tech_stack || []);
          setGaps(s.gaps || []);
          setRenewals(s.renewals || []);
          setAutomations(s.automations || []);
          if (s.findings) {
            setFindings(s.findings.map((f: Record<string, unknown>, i: number) => ({ ...f, id: i + 1 })));
            const total = s.findings.reduce((sum: number, f: Record<string, unknown>) => {
              const amt = typeof f.amount === "string" ? parseInt(f.amount.replace(/[^0-9]/g, "")) : 0;
              return sum + (isNaN(amt) ? 0 : amt);
            }, 0);
            setTotalSavings(total);
          }
          if (s.agentLogs) {
            setAgentLog(s.agentLogs.map((l: Record<string, unknown>) => ({
              id: Date.now() + Math.random(),
              agent: l.agent,
              message: l.message,
              timestamp: new Date(l.created_at as string).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
              type: l.log_type || "progress",
            })));
          }
          setScanSource("google-personal");
          setMode("done");
        }
      })
      .catch(() => { /* no saved results, show landing page */ });
  }, [startGoogleScan]);

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="pt-24 md:pt-32 px-5 md:px-18 max-w-5xl mx-auto pb-16">
        {mode === "choose" && (
          <ChooseMode startGoogleScan={startGoogleScan} />
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
            totalSavings={totalSavings}
            scanSource={scanSource}
            agentLog={agentLog}
            techStack={techStack}
            gaps={gaps}
            summary={summary}
            renewals={renewals}
            automations={automations}
            workflows={workflows}
            activeSection={activeSection}
            setActiveSection={setActiveSection}
            handleFile={handleFile}
            onReset={() => { setMode("choose"); setFindings([]); setTotalSavings(0); setAgentLog([]); setTechStack([]); setGaps([]); setSummary({}); setRenewals([]); setAutomations([]); setWorkflows([]); setActiveSection(null); }}
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
function ChooseMode({ startGoogleScan }: {
  startGoogleScan: (admin: boolean) => void;
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
        Google will show a security warning because we're new. Click <b style={{ color: "#6b6560" }}>Advanced</b> then <b style={{ color: "#6b6560" }}>"Go to upskiller-scanner.vercel.app"</b> to proceed safely. We only read your email metadata, never store anything.
      </p>

      {/* Alternative sign-in options */}
      <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <a
          href="/api/auth/microsoft"
          className="text-center py-2.5 px-5 text-sm font-medium rounded-full transition-all hover:bg-[#f0ede8] flex items-center justify-center gap-2"
          style={{ border: "1px solid #ddd8d0", color: "#6b6560" }}
        >
          <svg width="14" height="14" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
          Sign in with Microsoft
        </a>
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
          Your Command Center populates with everything we found. We discover your workflows, map your tech stack, and identify what's automatable. Gaps show exactly what to provide next to unlock deeper findings.
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
            <span className="text-xs tabular-nums" style={{ color: "#a8a29e" }}><b className="text-[#6b6560] font-semibold">{progress.scanned.toLocaleString()}</b> / {progress.records.toLocaleString()} records</span>
            <span className="text-xs tabular-nums" style={{ color: "#a8a29e" }}><b className="text-[#6b6560] font-semibold">{findings.length}</b> findings</span>
            {totalSavings > 0 && <span className="text-xs tabular-nums" style={{ color: "#a8a29e" }}><b className="text-[#c4501e] font-semibold">${totalSavings.toLocaleString()}K</b> surfaced</span>}
          </div>
        </div>
      )}

      {/* Mini Command Center Preview */}
      {(techStack.length > 0 || summary.totalAnnualSpend) && (
        <div className="mt-8 rounded-xl overflow-hidden" style={{ background: "#1a1a1a" }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.4)" }}>Command Center Preview</span>
            {summary.coverageScore != null && (
              <span className="text-xs tabular-nums" style={{ color: "rgba(255,255,255,0.3)" }}>Coverage: {summary.coverageScore}%</span>
            )}
          </div>
          <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
            {summary.totalAnnualSpend && (
              <div className="p-4 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>Est. Annual Spend</p>
                <p className="mt-2 font-fraunces text-xl font-light" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.03em" }}>{summary.totalAnnualSpend}</p>
              </div>
            )}
            {summary.totalAnnualWaste && (
              <div className="p-4 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>Waste Identified</p>
                <p className="mt-2 font-fraunces text-xl font-light" style={{ color: "#c4501e", letterSpacing: "-0.03em" }}>{summary.totalAnnualWaste}</p>
              </div>
            )}
            <div className="p-4 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>Apps Discovered</p>
              <p className="mt-2 font-fraunces text-xl font-light" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.03em" }}>{summary.appsDiscovered || techStack.length}</p>
            </div>
            <div className="p-4 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>Findings</p>
              <p className="mt-2 font-fraunces text-xl font-light" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.03em" }}>{findings.length}</p>
            </div>
          </div>
          {/* Tech stack strip */}
          {techStack.length > 0 && (
            <div className="px-5 pb-4">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.25)" }}>Tech Stack</p>
              <div className="flex flex-wrap gap-2">
                {techStack.slice(0, 20).map((app) => (
                  <span key={app.name} className="text-xs px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}>
                    {app.name} <span style={{ color: "rgba(255,255,255,0.25)" }}>{app.estimatedCost}</span>
                  </span>
                ))}
                {techStack.length > 20 && (
                  <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.2)" }}>
                    +{techStack.length - 20} more
                  </span>
                )}
              </div>
            </div>
          )}
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
function DoneView({ findings, totalSavings, scanSource, agentLog, techStack, gaps, summary, renewals, automations, workflows, activeSection, setActiveSection, handleFile, onReset }: {
  findings: Finding[];
  totalSavings: number;
  scanSource: string;
  agentLog: AgentLogEntry[];
  techStack: TechStackApp[];
  gaps: GapItem[];
  summary: ScanSummary;
  renewals: { vendor: string; renewalDate: string; estimatedCost: string; action: string; urgency: string }[];
  automations: { process: string; evidence: string; estimatedTimeSavings: string; recommendedTool: string; complexity: string }[];
  workflows: { name: string; type: string; description: string; frequency: string; participants: string[]; automationScore: number; agentBlueprint?: { trigger: string; steps: string[]; humanInTheLoop: string; complexity: string }; estimatedTimeSavings: string; estimatedAnnualSavings: string; evidence: string }[];
  activeSection: "spend" | "workflows" | "waste" | null;
  setActiveSection: (s: "spend" | "workflows" | "waste" | null) => void;
  handleFile: (file: File) => void;
  onReset: () => void;
}) {
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  const gapFileRef = useRef<HTMLInputElement>(null);
  const [activeGap, setActiveGap] = useState<string | null>(null);

  return (
    <div className="animate-fade-up">
      {/* ════════════════════════════════════════ */}
      {/* THE CINEMATIC REVEAL                  */}
      {/* ════════════════════════════════════════ */}

      {/* Reveal line 1 */}
      <div className="text-center pt-4 md:pt-8">
        <p className="text-xs md:text-sm animate-fade-in reveal-1" style={{ color: "#a8a29e" }}>
          We scanned {summary.appsDiscovered || techStack.length || "your"} months of email data.
        </p>
      </div>

      {/* Reveal line 2 — the tech stack count */}
      <div className="text-center mt-6 md:mt-8">
        <p className="text-sm md:text-base font-medium animate-fade-in reveal-2" style={{ color: "#6b6560" }}>
          We found <b className="text-[#1a1a1a]">{summary.appsDiscovered || techStack.length} tools</b> your organization pays for.
        </p>
      </div>

      {/* Reveal line 3 — workflows */}
      {(workflows.length > 0 || summary.workflowsDiscovered) && (
        <div className="text-center mt-4 md:mt-6">
          <p className="text-sm md:text-base font-medium animate-fade-in reveal-3" style={{ color: "#6b6560" }}>
            <b className="text-[#1a1a1a]">{summary.workflowsDiscovered || workflows.length} manual workflows</b> running on human effort.{" "}
            <span style={{ color: "#10b981" }}>{summary.workflowsAutomatable || workflows.filter(w => w.automationScore >= 70).length} are automatable.</span>
          </p>
        </div>
      )}

      {/* THE BIG NUMBER — the gasp moment with count-up */}
      <div className="text-center mt-8 md:mt-12 mb-4 md:mb-8">
        <h2 className="font-fraunces text-5xl md:text-8xl font-light animate-count-up reveal-4" style={{ color: "#c4501e", letterSpacing: "-0.04em" }}>
          <CountUpDollar value={summary.totalAnnualWaste || `$${totalSavings}K`} />
        </h2>
        <p className="text-sm mt-2 md:mt-3 animate-fade-in reveal-5" style={{ color: "#6b6560" }}>
          in addressable waste — from email alone
        </p>
      </div>

      {/* Coverage teaser — the hook */}
      <div className="text-center mb-8 md:mb-10 animate-fade-in reveal-5">
        <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-full" style={{ background: "#f0ede8" }}>
          <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: "#ddd8d0" }}>
            <div className="h-full rounded-full coverage-fill" style={{ width: `${summary.coverageScore || 35}%`, background: "linear-gradient(90deg, #c4501e, #f59e0b)" }} />
          </div>
          <span className="text-xs font-medium tabular-nums" style={{ color: "#6b6560" }}>
            {summary.coverageScore || 35}% of the picture — <a href="#gaps" className="underline" style={{ color: "#c4501e" }}>unlock the rest</a>
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-3 mb-10">
        <button onClick={onReset} className="text-xs font-medium px-4 py-2 rounded-full transition-all hover:bg-[#f0ede8]" style={{ border: "1px solid #ddd8d0", color: "#6b6560" }}>New scan</button>
        <a href="mailto:scotty@upskillerai.com?subject=Scanner%20found%20waste%20—%20want%20full%20engagement" className="text-xs font-semibold px-5 py-2.5 rounded-full bg-[#1a1a1a] text-[#faf9f7] hover:bg-[#333] transition-all">Talk to us about a full engagement</a>
      </div>

      {/* ════════════════════════════════════════ */}
      {/* THREE PILLARS — doors to explore        */}
      {/* ════════════════════════════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mb-8">
        {([
          { key: "spend" as const, icon: "💰", label: "SPEND", value: summary.totalAnnualSpend || "—", sub: `across ${summary.appsDiscovered || techStack.length} tools`, color: "#3b82f6" },
          { key: "workflows" as const, icon: "⚡", label: "WORKFLOWS", value: String(summary.workflowsDiscovered || workflows.length || "—"), sub: `${summary.workflowsAutomatable || workflows.filter(w => w.automationScore >= 70).length || 0} automatable`, color: "#10b981" },
          { key: "waste" as const, icon: "🔍", label: "WASTE", value: summary.totalAnnualWaste || `$${totalSavings.toLocaleString()}K`, sub: `${findings.length} findings`, color: "#c4501e" },
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
      {activeSection === "workflows" && workflows.length > 0 && (
        <div className="mb-8 animate-fade-up rounded-xl overflow-hidden" style={{ border: "2px solid #10b981" }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ background: "rgba(16,185,129,0.04)", borderBottom: "1px solid rgba(16,185,129,0.1)" }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#10b981" }}>Discovered Workflows</span>
            <button onClick={() => setActiveSection(null)} className="text-xs" style={{ color: "#a8a29e" }}>Close</button>
          </div>
          <div className="p-4 space-y-3">
            {workflows.map((w, i) => (
              <div key={i} className="p-4 rounded-lg" style={{ border: "1px solid #ddd8d0" }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: w.automationScore >= 70 ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)", color: w.automationScore >= 70 ? "#10b981" : "#f59e0b" }}>
                        {w.automationScore}% automatable
                      </span>
                      <span className="text-xs uppercase tracking-wider" style={{ color: "#a8a29e" }}>{w.frequency}</span>
                    </div>
                    <h4 className="text-sm font-semibold mb-1">{w.name}</h4>
                    <p className="text-sm leading-relaxed" style={{ color: "#6b6560" }}>{w.description}</p>
                    {w.agentBlueprint && (
                      <div className="mt-3 p-3 rounded-lg" style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.1)" }}>
                        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#10b981" }}>What an AI agent would do</p>
                        <p className="text-xs mb-1" style={{ color: "#6b6560" }}>Trigger: {w.agentBlueprint.trigger}</p>
                        <ol className="text-xs list-decimal pl-4 space-y-0.5" style={{ color: "#6b6560" }}>
                          {w.agentBlueprint.steps.map((step, j) => <li key={j}>{step}</li>)}
                        </ol>
                        {w.agentBlueprint.humanInTheLoop && (
                          <p className="text-xs mt-1" style={{ color: "#f59e0b" }}>Human stays in loop: {w.agentBlueprint.humanInTheLoop}</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {w.estimatedAnnualSavings && <p className="font-fraunces text-lg font-light" style={{ color: "#10b981", letterSpacing: "-0.02em" }}>{w.estimatedAnnualSavings}</p>}
                    <p className="text-xs" style={{ color: "#a8a29e" }}>{w.estimatedTimeSavings} saved</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Mini Command Center */}
      <div className="mt-8 rounded-xl overflow-hidden" style={{ background: "#1a1a1a" }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.4)" }}>Command Center</span>
          {summary.coverageScore != null && (
            <div className="flex items-center gap-3">
              <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)" }}>
                <div className="h-full rounded-full bg-[#4ade80] transition-all" style={{ width: `${summary.coverageScore}%` }} />
              </div>
              <span className="text-xs tabular-nums" style={{ color: "rgba(255,255,255,0.3)" }}>{summary.coverageScore}% coverage</span>
            </div>
          )}
        </div>
        <div className="p-5 grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="p-4 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>Annual Spend</p>
            <p className="mt-2 font-fraunces text-xl font-light" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.03em" }}>{summary.totalAnnualSpend || "—"}</p>
          </div>
          <div className="p-4 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>Waste Found</p>
            <p className="mt-2 font-fraunces text-xl font-light" style={{ color: "#c4501e", letterSpacing: "-0.03em" }}>{summary.totalAnnualWaste || `$${totalSavings.toLocaleString()}K`}</p>
          </div>
          <div className="p-4 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>Apps</p>
            <p className="mt-2 font-fraunces text-xl font-light" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "-0.03em" }}>{summary.appsDiscovered || techStack.length}</p>
          </div>
          <div className="p-4 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>Critical</p>
            <p className="mt-2 font-fraunces text-xl font-light" style={{ color: criticalCount > 0 ? "#c4501e" : "rgba(255,255,255,0.85)", letterSpacing: "-0.03em" }}>{criticalCount}</p>
          </div>
          <div className="p-4 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>High</p>
            <p className="mt-2 font-fraunces text-xl font-light" style={{ color: highCount > 0 ? "#f59e0b" : "rgba(255,255,255,0.85)", letterSpacing: "-0.03em" }}>{highCount}</p>
          </div>
        </div>

        {/* Tech Stack Strip */}
        {techStack.length > 0 && (
          <div className="px-5 pb-4">
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.25)" }}>
              Discovered Tech Stack ({techStack.length} tools)
            </p>
            <div className="flex flex-wrap gap-2">
              {techStack.slice(0, 25).map((app) => (
                <span key={app.name} className="text-xs px-2.5 py-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}>
                  {app.name} <span style={{ color: "rgba(255,255,255,0.25)" }}>{app.estimatedCost}</span>
                </span>
              ))}
              {techStack.length > 25 && (
                <span className="text-xs px-2.5 py-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.2)" }}>+{techStack.length - 25} more</span>
              )}
            </div>
          </div>
        )}

        {/* Spend by Category */}
        {summary.spendByCategory && Object.keys(summary.spendByCategory).length > 0 && (
          <div className="px-5 pb-5">
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.25)" }}>Spend by Category</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(summary.spendByCategory).slice(0, 8).map(([cat, amount]) => (
                <div key={cat} className="flex items-baseline justify-between px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{cat}</span>
                  <span className="text-xs font-medium tabular-nums" style={{ color: "rgba(255,255,255,0.6)" }}>{amount}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

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
              Imagine what we'd find with access to your actual systems.
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
            <div className="grid grid-cols-4 gap-0 px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ background: "#f0ede8", color: "#a8a29e" }}>
              <span>Vendor</span><span>Renewal Date</span><span>Est. Cost</span><span>Action</span>
            </div>
            {renewals.map((r, i) => (
              <div key={i} className="grid grid-cols-4 gap-0 px-5 py-3 items-center" style={{ borderTop: "1px solid #ddd8d0" }}>
                <span className="text-sm font-medium">{r.vendor}</span>
                <span className="text-sm tabular-nums" style={{ color: "#6b6560" }}>{r.renewalDate}</span>
                <span className="text-sm font-medium tabular-nums">{r.estimatedCost}</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full inline-block w-fit" style={{
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
        <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "rgba(255,255,255,0.3)" }}>Ready for the full picture?</p>
        <h3 className="font-fraunces text-xl md:text-2xl font-light text-white/90 max-w-lg mx-auto" style={{ letterSpacing: "-0.02em" }}>
          {summary.totalAnnualWaste || `$${totalSavings.toLocaleString()}K`} found from {summary.coverageScore || 35}% visibility.
          <br />
          <span style={{ color: "#f59e0b" }}>What's hiding in the other {100 - (summary.coverageScore || 35)}%?</span>
        </h3>
        <p className="mt-4 text-sm text-white/40 max-w-md mx-auto leading-relaxed">
          Two-week engagement. Fixed fee. We connect to all your systems, run continuously, and surface everything.
        </p>
        <a href="mailto:scotty@upskillerai.com?subject=Full%20engagement%20—%20scanner%20found%20${encodeURIComponent(summary.totalAnnualWaste || totalSavings + 'K')}%20waste" className="mt-6 inline-flex text-sm font-semibold px-7 py-3 rounded-full bg-[#faf9f7] text-[#1a1a1a] hover:bg-[#eee] transition-all hover:-translate-y-0.5 hover:shadow-lg">
          Schedule a walkthrough
        </a>
      </div>
    </div>
  );
}

/* ─── SHARED COMPONENTS ─── */
function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="p-5 rounded-lg" style={{ border: "1px solid #ddd8d0" }}>
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#a8a29e" }}>{label}</p>
      <p className="mt-2 font-fraunces text-2xl font-light" style={{ letterSpacing: "-0.03em", color: color || "#1a1a1a" }}>{value}</p>
    </div>
  );
}

function FindingsList({ findings }: { findings: Finding[] }) {
  const colors = {
    critical: { bg: "rgba(196,80,30,0.08)", text: "#c4501e" },
    high: { bg: "rgba(245,158,11,0.08)", text: "#f59e0b" },
    medium: { bg: "rgba(59,130,246,0.08)", text: "#3b82f6" },
  };
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
                <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: colors[f.severity].bg, color: colors[f.severity].text }}>{f.severity}</span>
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
      <div className="flex gap-6">
        <a href="https://upskillerai.com" className="text-xs hover:text-[#1a1a1a] transition-colors" style={{ color: "#a8a29e" }}>Home</a>
        <a href="mailto:scotty@upskillerai.com" className="text-xs hover:text-[#1a1a1a] transition-colors" style={{ color: "#a8a29e" }}>Contact</a>
      </div>
    </footer>
  );
}
