"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EventWorkbook, SheetData, SheetRow } from "@/lib/sheets";

type FetchState = "loading" | "ready" | "error";

export default function EventDashboard() {
  const [workbook, setWorkbook] = useState<EventWorkbook | null>(null);
  const [status, setStatus] = useState<FetchState>("loading");
  const [activeSlug, setActiveSlug] = useState<string>("overview");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadWorkbook = useCallback(async () => {
    try {
      const response = await fetch("/api/event", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = (await response.json()) as EventWorkbook;

      setWorkbook(data);
      setStatus("ready");
      setError(null);
    } catch (loadError) {
      setStatus("error");
      setError(loadError instanceof Error ? loadError.message : "Unable to load event data");
    }
  }, []);

  useEffect(() => {
    void loadWorkbook();
  }, [loadWorkbook]);

  useEffect(() => {
    if (!workbook) {
      return;
    }

    const interval = setInterval(() => {
      void loadWorkbook();
    }, Math.max(10, workbook.refreshSeconds) * 1000);

    return () => clearInterval(interval);
  }, [loadWorkbook, workbook?.refreshSeconds]);

  useEffect(() => {
    if (!workbook) {
      return;
    }

    if (workbook.refreshSeconds > 0) {
      const root = document.documentElement;
      root.style.setProperty("--refresh-seconds", `${workbook.refreshSeconds}s`);
    }
  }, [workbook]);

  const activeSheet = useMemo(
    () => workbook?.tabs.find((tab) => tab.slug === activeSlug),
    [activeSlug, workbook]
  );

  const totals = useMemo(() => {
    const tabs = workbook?.tabs || [];
    const totalTasks = tabs.reduce((total, tab) => total + tab.totalTasks, 0);
    const completedTasks = tabs.reduce((total, tab) => total + tab.completedTasks, 0);
    const points = tabs.reduce((total, tab) => total + tab.points, 0);
    const completionPercent = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

    return { totalTasks, completedTasks, points, completionPercent };
  }, [workbook]);

  const filteredRows = useMemo(() => {
    if (!activeSheet) {
      return [];
    }

    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) {
      return activeSheet.rows;
    }

    return activeSheet.rows.filter((row) =>
      [row.taskName, row.statusLabel, ...row.values]
        .join(" ")
        .toLowerCase()
        .includes(cleanQuery)
    );
  }, [activeSheet, query]);

  if (status === "loading" && !workbook) {
    return <LoadingScreen />;
  }

  if (status === "error" && !workbook) {
    return <ErrorScreen message={error || "Unable to load event data"} />;
  }

  if (!workbook) {
    return null;
  }

  return (
    <main className="site-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">{workbook.clanName}</p>
          <h1>{workbook.eventName}</h1>
          <p className="hero-copy">
            Live event progress powered by Google Sheets. The website refreshes itself while the
            sheet remains the source of truth.
          </p>
        </div>

        <div className="hero-stat-card">
          <span className="stat-label">Overall progress</span>
          <strong>{totals.completionPercent}%</strong>
          <ProgressBar value={totals.completionPercent} />
          <span className="stat-subtext">
            {totals.completedTasks} of {totals.totalTasks} tracked rows complete
          </span>
        </div>
      </section>

      {workbook.warning ? <div className="warning-banner">{workbook.warning}</div> : null}
      {workbook.sourceMode === "demo" ? (
        <div className="warning-banner">
          Demo mode is active. Set <code>PUBLISHED_SHEET_URL</code> to connect your live event
          spreadsheet.
        </div>
      ) : null}

      <section className="summary-grid" aria-label="Event summary">
        <SummaryCard label="Visible tabs" value={workbook.tabs.length.toString()} />
        <SummaryCard label="Completed" value={totals.completedTasks.toString()} />
        <SummaryCard label="Total rows" value={totals.totalTasks.toString()} />
        <SummaryCard label="Points" value={totals.points.toString()} />
      </section>

      <section className="content-card">
        <div className="toolbar">
          <div className="tab-list" aria-label="Sheet tabs">
            <button
              className={activeSlug === "overview" ? "tab active" : "tab"}
              onClick={() => setActiveSlug("overview")}
              type="button"
            >
              Overview
            </button>
            {workbook.tabs.map((tab) => (
              <button
                className={activeSlug === tab.slug ? "tab active" : "tab"}
                key={tab.gid}
                onClick={() => setActiveSlug(tab.slug)}
                type="button"
              >
                {tab.name}
              </button>
            ))}
          </div>

          {activeSlug !== "overview" ? (
            <input
              aria-label="Search rows"
              className="search-input"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks..."
              value={query}
            />
          ) : null}
        </div>

        {activeSlug === "overview" ? (
          <Overview tabs={workbook.tabs} onSelectTab={setActiveSlug} />
        ) : activeSheet ? (
          <SheetView rows={filteredRows} sheet={activeSheet} />
        ) : (
          <p className="muted">The selected tab could not be found.</p>
        )}
      </section>

      <footer className="footer">
        <span>Last refreshed: {formatDateTime(workbook.generatedAt)}</span>
        <span>Refresh interval: {workbook.refreshSeconds}s</span>
      </footer>
    </main>
  );
}

function Overview({ tabs, onSelectTab }: { tabs: SheetData[]; onSelectTab: (slug: string) => void }) {
  return (
    <div className="team-grid">
      {tabs.map((tab) => (
        <button className="team-card" key={tab.gid} onClick={() => onSelectTab(tab.slug)} type="button">
          <div className="team-card-header">
            <h2>{tab.name}</h2>
            <span>{tab.completionPercent}%</span>
          </div>
          <ProgressBar value={tab.completionPercent} />
          <div className="team-card-meta">
            <span>{tab.completedTasks} complete</span>
            <span>{tab.totalTasks} rows</span>
            <span>{tab.points} points</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function SheetView({ sheet, rows }: { sheet: SheetData; rows: SheetRow[] }) {
  return (
    <div className="sheet-view">
      <div className="sheet-heading">
        <div>
          <p className="eyebrow">Sheet tab</p>
          <h2>{sheet.name}</h2>
        </div>
        <div className="sheet-progress">
          <strong>{sheet.completionPercent}%</strong>
          <span>{sheet.completedTasks} complete</span>
        </div>
      </div>

      <ProgressBar value={sheet.completionPercent} />

      <div className="task-grid">
        {rows.map((row) => (
          <article className={row.completed ? "task-card complete" : "task-card"} key={row.id}>
            <div className="task-card-header">
              <h3>{row.taskName}</h3>
              <StatusPill completed={row.completed} label={row.statusLabel} />
            </div>
            <dl>
              {sheet.headers.slice(0, 6).map((header) => {
                const value = row.cells[header];
                if (!value) {
                  return null;
                }

                return (
                  <div key={header}>
                    <dt>{header}</dt>
                    <dd>{renderValue(value)}</dd>
                  </div>
                );
              })}
            </dl>
          </article>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {sheet.headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {sheet.headers.map((header) => (
                  <td key={header}>{renderValue(row.cells[header])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-track" aria-label={`${safeValue}% complete`}>
      <div className="progress-fill" style={{ width: `${safeValue}%` }} />
    </div>
  );
}

function StatusPill({ completed, label }: { completed: boolean; label: string }) {
  return <span className={completed ? "status-pill complete" : "status-pill"}>{label}</span>;
}

function LoadingScreen() {
  return (
    <main className="state-screen">
      <div className="loader" />
      <h1>Loading event tracker</h1>
      <p>Reading the published Google Sheet.</p>
    </main>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <main className="state-screen">
      <h1>Unable to load event tracker</h1>
      <p>{message}</p>
    </main>
  );
}

function renderValue(value: string) {
  if (!value) {
    return <span className="muted">—</span>;
  }

  if (/^https?:\/\//i.test(value)) {
    return (
      <a href={value} rel="noreferrer" target="_blank">
        Open link
      </a>
    );
  }

  return value;
}

function formatDateTime(value: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}
