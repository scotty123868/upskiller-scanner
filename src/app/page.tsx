"use client";

import { useState, useCallback, useRef, useEffect } from "react";

type Finding = {
  id: number;
  title: string;
  description: string;
  amount: string | null;
  severity: "critical" | "high" | "medium";
  category: string;
};

type ScanMode = "choose" | "uploading" | "scanning" | "done";

type AgentLogEntry = {
  id: number;
  agent: string;
  message: string;
  timestamp: string;
  type: "discovery" | "analysis" | "finding" | "progress";
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
            } else if (event.type === "finding") {
              findingId++;
              setFindings((prev) => [...prev, { id: findingId, ...event }]);
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

  // Check for OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("scan") === "ready") {
      const adminMode = params.get("mode") === "admin";
      window.history.replaceState({}, "", "/");
      startGoogleScan(adminMode);
    }
  }, [startGoogleScan]);

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="pt-32 px-6 md:px-18 max-w-5xl mx-auto pb-16">
        {mode === "choose" && (
          <ChooseMode
            dragActive={dragActive}
            handleDrag={handleDrag}
            handleDrop={handleDrop}
            fileInputRef={fileInputRef}
            handleFile={handleFile}
            startGoogleScan={startGoogleScan}
          />
        )}
        {mode === "uploading" && <UploadingState fileName={fileName} />}
        {mode === "scanning" && (
          <ScanningView
            progress={scanProgress}
            findings={findings}
            totalSavings={totalSavings}
            agentLog={agentLog}
            scanSource={scanSource}
          />
        )}
        {mode === "done" && (
          <DoneView
            findings={findings}
            totalSavings={totalSavings}
            scanSource={scanSource}
            agentLog={agentLog}
            onReset={() => { setMode("choose"); setFindings([]); setTotalSavings(0); setAgentLog([]); }}
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
    <nav className="fixed top-0 left-0 right-0 z-50 px-6 md:px-18 h-15 flex items-center justify-between" style={{ background: "rgba(250,249,247,0.88)", backdropFilter: "blur(24px)", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
      <a href="https://upskillerai.com" className="font-fraunces font-medium text-lg" style={{ letterSpacing: "-0.03em" }}>UpSkiller</a>
      <div className="flex items-center gap-4">
        <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "#a8a29e" }}>Scanner</span>
        <a href="mailto:scotty@upskillerai.com" className="text-sm font-semibold px-5 py-2.5 rounded-full bg-[#1a1a1a] text-[#faf9f7] hover:bg-[#333] transition-all">Talk to us</a>
      </div>
    </nav>
  );
}

/* ─── CHOOSE MODE ─── */
function ChooseMode({ dragActive, handleDrag, handleDrop, fileInputRef, handleFile, startGoogleScan }: {
  dragActive: boolean;
  handleDrag: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFile: (file: File) => void;
  startGoogleScan: (admin: boolean) => void;
}) {
  return (
    <div className="animate-fade-up">
      <h1 className="font-fraunces text-4xl md:text-5xl font-light leading-tight" style={{ letterSpacing: "-0.045em", textWrap: "balance" }}>
        See what your systems are sitting on.
      </h1>
      <p className="mt-5 text-base leading-relaxed max-w-lg" style={{ color: "#6b6560" }}>
        Connect once. Our agents autonomously crawl your environment, discover every tool, vendor, and cost, and surface findings in minutes.
      </p>

      {/* Two paths */}
      <div className="mt-12 grid md:grid-cols-2 gap-5">
        {/* Path A: Full Org */}
        <button
          onClick={() => startGoogleScan(true)}
          className="group text-left p-7 rounded-xl transition-all hover:-translate-y-1 hover:shadow-lg cursor-pointer"
          style={{ border: "1px solid #ddd8d0", background: "linear-gradient(180deg, rgba(59,130,246,0.03) 0%, #faf9f7 100%)" }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(59,130,246,0.08)" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
            </div>
            <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "#3b82f6" }}>Full Organization</span>
          </div>
          <h3 className="text-lg font-semibold mb-2">Scan your entire org</h3>
          <p className="text-sm leading-relaxed" style={{ color: "#6b6560" }}>
            Sign in as a Google Workspace admin. Our agents discover every app, user, license, and vendor invoice across your organization. One click, full visibility.
          </p>
          <div className="mt-5 flex items-center gap-2 text-sm font-semibold" style={{ color: "#3b82f6" }}>
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>
            Sign in with Google Workspace
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="transition-transform group-hover:translate-x-1"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        </button>

        {/* Path B: Personal */}
        <button
          onClick={() => startGoogleScan(false)}
          className="group text-left p-7 rounded-xl transition-all hover:-translate-y-1 hover:shadow-lg cursor-pointer"
          style={{ border: "1px solid #ddd8d0", background: "linear-gradient(180deg, rgba(16,185,129,0.03) 0%, #faf9f7 100%)" }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(16,185,129,0.08)" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </div>
            <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "#10b981" }}>Quick Scan</span>
          </div>
          <h3 className="text-lg font-semibold mb-2">Scan my accounts</h3>
          <p className="text-sm leading-relaxed" style={{ color: "#6b6560" }}>
            Sign in with your Google account. We read your inbox for invoices, receipts, and vendor emails. No admin access needed. Discover every tool and vendor you pay for.
          </p>
          <div className="mt-5 flex items-center gap-2 text-sm font-semibold" style={{ color: "#10b981" }}>
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>
            Sign in with Google
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="transition-transform group-hover:translate-x-1"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        </button>
      </div>

      {/* Divider */}
      <div className="mt-10 flex items-center gap-4">
        <div className="flex-1 h-px" style={{ background: "#ddd8d0" }} />
        <span className="text-xs font-medium" style={{ color: "#a8a29e" }}>or upload a file</span>
        <div className="flex-1 h-px" style={{ background: "#ddd8d0" }} />
      </div>

      {/* File upload zone (compact) */}
      <div
        className={`mt-6 border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${dragActive ? "border-[#c4501e] bg-[#c4501e]/5" : "border-[#ddd8d0] hover:border-[#a8a29e]"}`}
        onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="flex items-center justify-center gap-4">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div className="text-left">
            <p className="text-sm font-medium">Drop a CSV, Excel, or JSON file</p>
            <p className="text-xs" style={{ color: "#a8a29e" }}>AP invoices, vendor lists, license exports, equipment logs</p>
          </div>
        </div>
        <input ref={fileInputRef} type="file" className="hidden" accept=".csv,.xlsx,.xls,.json,.tsv"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>

      {/* Trust signals */}
      <div className="mt-12 flex items-center gap-8 flex-wrap">
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
function ScanningView({ progress, findings, totalSavings, agentLog, scanSource }: {
  progress: { records: number; scanned: number; message: string };
  findings: Finding[];
  totalSavings: number;
  agentLog: AgentLogEntry[];
  scanSource: string;
}) {
  const sourceLabel = scanSource === "google-admin" ? "Google Workspace" : scanSource === "google-personal" ? "Gmail" : "uploaded file";

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="font-fraunces text-3xl font-light" style={{ letterSpacing: "-0.03em" }}>Agents scanning {sourceLabel}</h2>
          <p className="mt-2 text-sm" style={{ color: "#6b6560" }}>{progress.message || "Initializing scan..."}</p>
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

      {/* Two-column: Agent log + Findings */}
      <div className="mt-8 grid md:grid-cols-5 gap-6">
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
function DoneView({ findings, totalSavings, scanSource, agentLog, onReset }: {
  findings: Finding[];
  totalSavings: number;
  scanSource: string;
  agentLog: AgentLogEntry[];
  onReset: () => void;
}) {
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;

  return (
    <div className="animate-fade-up">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h2 className="font-fraunces text-3xl md:text-4xl font-light" style={{ letterSpacing: "-0.03em" }}>Scan complete.</h2>
          <p className="mt-3 text-sm leading-relaxed max-w-md" style={{ color: "#6b6560" }}>
            {findings.length} actionable findings.
            {totalSavings > 0 && <> Estimated annualized impact: <b className="text-[#c4501e] font-semibold">${totalSavings.toLocaleString()}K</b>.</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onReset} className="text-sm font-medium px-5 py-2.5 rounded-full transition-all hover:bg-[#f0ede8]" style={{ border: "1px solid #ddd8d0", color: "#6b6560" }}>New scan</button>
          <a href="mailto:scotty@upskillerai.com?subject=Scanner%20results" className="text-sm font-semibold px-5 py-2.5 rounded-full bg-[#1a1a1a] text-[#faf9f7] hover:bg-[#333] transition-all">Talk to us about these</a>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Findings" value={findings.length.toString()} />
        <StatCard label="Critical" value={criticalCount.toString()} color="#c4501e" />
        <StatCard label="High Impact" value={highCount.toString()} color="#f59e0b" />
        <StatCard label="Est. Annual Impact" value={totalSavings > 0 ? `$${totalSavings.toLocaleString()}K` : "—"} color="#c4501e" />
      </div>

      {/* Two-column: Agent log + Findings */}
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

      {/* CTA */}
      <div className="mt-12 p-8 rounded-xl" style={{ background: "#1a1a1a" }}>
        <h3 className="font-fraunces text-xl font-light text-white/90" style={{ letterSpacing: "-0.02em" }}>
          {scanSource === "file" ? "This is from one file. Imagine what we'd find across all your systems." : "This is from one scan. We can go deeper."}
        </h3>
        <p className="mt-3 text-sm text-white/40 max-w-md leading-relaxed">
          Two-week engagement. Fixed fee. Read-only access to your actual systems. We connect to everything and surface findings like these at scale.
        </p>
        <a href="mailto:scotty@upskillerai.com?subject=Full%20engagement" className="mt-6 inline-flex text-sm font-semibold px-6 py-3 rounded-full bg-[#faf9f7] text-[#1a1a1a] hover:bg-[#eee] transition-all">Schedule a walkthrough</a>
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
  return (
    <>
      {findings.map((f, i) => (
        <div key={f.id} className="p-5 rounded-lg animate-fade-up" style={{ border: "1px solid #ddd8d0", animationDelay: `${i * 0.04}s` }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: colors[f.severity].bg, color: colors[f.severity].text }}>{f.severity}</span>
                <span className="text-xs uppercase tracking-wider font-medium" style={{ color: "#a8a29e" }}>{f.category}</span>
              </div>
              <h4 className="mt-2 text-sm font-semibold">{f.title}</h4>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: "#6b6560" }}>{f.description}</p>
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
