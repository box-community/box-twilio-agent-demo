"use client";

import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Cloud,
  Droplets,
  ExternalLink,
  FileText,
  Flame,
  Headphones,
  Home,
  Inbox,
  LoaderCircle,
  MoreHorizontal,
  Phone,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Wind,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { Claim } from "@/lib/types";

type Props = {
  initialClaims: Claim[];
  demoMode: boolean;
  connectionError?: string;
};

const lossIcons = {
  Water: Droplets,
  Fire: Flame,
  Weather: Wind,
  Theft: ShieldCheck,
  Liability: CircleAlert,
  Other: FileText,
};

function formatDate(value: string, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

export function ClaimWorkspace({ initialClaims, demoMode, connectionError }: Props) {
  const [claims, setClaims] = useState(initialClaims);
  const [selectedId, setSelectedId] = useState(initialClaims[0]?.id);
  const [tab, setTab] = useState<"overview" | "transcript">("overview");
  const [query, setQuery] = useState("");
  const [processing, setProcessing] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(connectionError);

  const filteredClaims = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return claims;
    return claims.filter((claim) =>
      [claim.claimNumber, claim.claimantName, claim.propertyAddress, claim.lossType]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [claims, query]);

  const selected = claims.find((claim) => claim.id === selectedId) || claims[0];
  const needsReview = claims.filter((claim) => claim.status === "Needs review").length;
  const urgent = claims.filter((claim) => ["High", "Critical"].includes(claim.severity)).length;

  async function runDemoCall() {
    setProcessing(true);
    setNotice(undefined);
    try {
      const response = await fetch("/api/claims/demo", { method: "POST" });
      const body = (await response.json()) as { claim?: Claim; error?: string };
      if (!response.ok || !body.claim) throw new Error(body.error || "The demo call could not be processed");
      setClaims((current) => [body.claim!, ...current.filter((claim) => claim.id !== body.claim!.id)]);
      setSelectedId(body.claim.id);
      setTab("overview");
      setNotice(demoMode ? "Demo claim created locally." : "Claim report and review task created in Box.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="Primary navigation">
        <div className="brand-mark" aria-label="Harbor">
          H
        </div>
        <nav className="rail-nav">
          <button className="rail-button" aria-label="Home"><Home size={19} /></button>
          <button className="rail-button active" aria-label="Claims"><Inbox size={19} /></button>
          <button className="rail-button" aria-label="Documents"><FileText size={19} /></button>
        </nav>
        <div className="avatar">AT</div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div>
            <div className="eyebrow">HARBOR HOME</div>
            <h1>Claims desk</h1>
          </div>
          <div className="topbar-actions">
            <div className={`connection-pill ${demoMode ? "demo" : "live"}`}>
              <span className="status-dot" />
              {demoMode ? "Demo data" : "Box connected"}
            </div>
            <button className="primary-button" onClick={runDemoCall} disabled={processing}>
              {processing ? <LoaderCircle className="spin" size={16} /> : <Play size={15} fill="currentColor" />}
              {processing ? "Processing…" : "Run demo call"}
            </button>
          </div>
        </header>

        {notice && (
          <div className="notice" role="status">
            <Sparkles size={15} />
            <span>{notice}</span>
            <button onClick={() => setNotice(undefined)} aria-label="Dismiss">×</button>
          </div>
        )}

        <section className="metrics" aria-label="Claim metrics">
          <div className="metric">
            <span>Open claims</span>
            <strong>{claims.filter((claim) => claim.status !== "Approved").length}</strong>
            <small>Across this workspace</small>
          </div>
          <div className="metric">
            <span>Needs review</span>
            <strong>{needsReview}</strong>
            <small>{needsReview === 1 ? "New task in Box" : "New tasks in Box"}</small>
          </div>
          <div className="metric accent">
            <span>Priority</span>
            <strong>{urgent}</strong>
            <small>High-severity intake</small>
          </div>
          <div className="call-flow">
            <div className="call-flow-icon"><Phone size={18} /></div>
            <div><strong>Voice intake is ready</strong><span>Twilio → OpenAI → Box</span></div>
            <ChevronRight size={18} />
          </div>
        </section>

        <section className="workspace">
          <div className="queue-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">CLAIM QUEUE</span>
                <h2>Recent intake</h2>
              </div>
              <button className="icon-button" aria-label="More options"><MoreHorizontal size={20} /></button>
            </div>
            <label className="search-field">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search claims" />
            </label>
            <div className="claim-list">
              {filteredClaims.map((claim) => {
                const Icon = lossIcons[claim.lossType];
                return (
                  <button
                    key={claim.id}
                    className={`claim-row ${selected?.id === claim.id ? "selected" : ""}`}
                    onClick={() => { setSelectedId(claim.id); setTab("overview"); }}
                  >
                    <span className={`loss-icon ${claim.lossType.toLowerCase()}`}><Icon size={17} /></span>
                    <span className="claim-row-copy">
                      <span className="claim-row-top"><strong>{claim.claimantName}</strong><time>{formatDate(claim.filedAt)}</time></span>
                      <span>{claim.lossType} · {claim.claimNumber}</span>
                      <small>{claim.propertyAddress}</small>
                    </span>
                    {claim.status === "Needs review" && <span className="unread-dot" />}
                  </button>
                );
              })}
              {filteredClaims.length === 0 && <div className="empty-state">No claims match that search.</div>}
            </div>
          </div>

          {selected ? (
            <article className="detail-panel">
              <header className="claim-header">
                <div className="claimant-avatar">{initials(selected.claimantName)}</div>
                <div className="claim-title">
                  <div className="claim-title-line">
                    <h2>{selected.claimantName}</h2>
                    <span className={`status-badge ${selected.status.toLowerCase().replaceAll(" ", "-")}`}>{selected.status}</span>
                  </div>
                  <p>{selected.claimNumber} <span>·</span> Filed {formatDate(selected.filedAt, true)}</p>
                </div>
                {selected.boxUrl && (
                  <a className="secondary-button" href={selected.boxUrl} target="_blank" rel="noreferrer">
                    Open in Box <ExternalLink size={14} />
                  </a>
                )}
              </header>

              <div className="tabs" role="tablist">
                <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button>
                <button className={tab === "transcript" ? "active" : ""} onClick={() => setTab("transcript")}>Transcript <span>{selected.transcript.length}</span></button>
              </div>

              {tab === "overview" ? (
                <div className="detail-scroll">
                  <section className="summary-card">
                    <div className="section-label"><Sparkles size={15} /> AI CALL SUMMARY</div>
                    <p>{selected.summary}</p>
                  </section>

                  <div className="content-grid">
                    <div className="content-main">
                      <section className="detail-section">
                        <div className="section-heading"><h3>Loss details</h3><span className={`severity ${selected.severity.toLowerCase()}`}>{selected.severity} severity</span></div>
                        <dl className="facts-grid">
                          <div><dt>Date of loss</dt><dd>{selected.lossDate}</dd></div>
                          <div><dt>Loss type</dt><dd>{selected.lossType}</dd></div>
                          <div className="wide"><dt>Property</dt><dd>{selected.propertyAddress}</dd></div>
                          <div className="wide"><dt>Callback</dt><dd>{selected.phone}</dd></div>
                        </dl>
                      </section>

                      <section className="detail-section">
                        <h3>Affected areas</h3>
                        <div className="tag-list">
                          {selected.damageAreas.map((area) => <span key={area}>{area}</span>)}
                        </div>
                        {selected.immediateRisks.length > 0 && (
                          <div className="risk-box"><CircleAlert size={17} /><div><strong>Immediate attention</strong><p>{selected.immediateRisks.join(" · ")}</p></div></div>
                        )}
                      </section>

                      <section className="detail-section">
                        <h3>Recommended next steps</h3>
                        <ol className="next-steps">
                          {selected.nextSteps.map((step, index) => (
                            <li key={step}><span>{index + 1}</span><p>{step}</p></li>
                          ))}
                        </ol>
                      </section>
                    </div>

                    <aside className="content-side">
                      <section className="coverage-card">
                        <div className="section-label"><ShieldCheck size={15} /> POLICY CHECK</div>
                        <div className="coverage-result"><span className="coverage-check"><Check size={15} strokeWidth={3} /></span><strong>{selected.coverageStatus}</strong></div>
                        <p>{selected.coverageRationale}</p>
                        <div className="deductible"><span>Potential deductible</span><strong>{selected.deductible}</strong></div>
                        <small>Preliminary analysis · Human review required</small>
                      </section>

                      <section className="box-card">
                        <div className="box-card-top"><span className="box-logo">box</span><span className={`task-chip ${selected.taskStatus.toLowerCase()}`}>{selected.taskStatus}</span></div>
                        <strong>Review task</strong>
                        <p>Claim report, metadata, and review workflow are stored together.</p>
                        {selected.boxUrl ? (
                          <a href={selected.boxUrl} target="_blank" rel="noreferrer">View source file <ArrowUpRight size={14} /></a>
                        ) : (
                          <span className="demo-note"><Cloud size={14} /> Connect Box to sync</span>
                        )}
                      </section>

                      <section className="notes-card">
                        <div className="section-label"><ClipboardCheck size={15} /> ADJUSTER NOTES</div>
                        <ul>{selected.notes.map((note) => <li key={note}>{note}</li>)}</ul>
                      </section>
                    </aside>
                  </div>
                </div>
              ) : (
                <div className="transcript-view">
                  <div className="transcript-intro"><Headphones size={18} /><div><strong>Call transcript</strong><span>Captured by Twilio Agent Connect</span></div></div>
                  {selected.transcript.length ? selected.transcript.map((turn, index) => (
                    <div className={`turn ${turn.role}`} key={`${turn.role}-${index}`}>
                      <span className="speaker">{turn.role === "caller" ? initials(selected.claimantName) : "H"}</span>
                      <div><strong>{turn.role === "caller" ? selected.claimantName : "Harbor agent"}</strong><p>{turn.text}</p></div>
                    </div>
                  )) : <div className="empty-state transcript-empty">The full transcript is available in the Box report.</div>}
                </div>
              )}
            </article>
          ) : (
            <div className="detail-panel empty-detail"><FileText size={28} /><p>No claims yet.</p></div>
          )}
        </section>
      </section>
    </main>
  );
}
