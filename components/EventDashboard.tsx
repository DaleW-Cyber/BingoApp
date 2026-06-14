"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EventWorkbook, SheetCell, SheetData } from "@/lib/sheets";

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
  }, [loadWorkbook, workbook]);

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
            Live event progress powered by Google Sheets. This version preserves the sheet layout
            instead of guessing which cells are bingo tiles.
          </p>
        </div>

        <div className="hero-stat-card">
          <span className="stat-label">Detected completed cells</span>
          <strong>{totals.completionPercent}%</strong>
          <ProgressBar value={totals.completionPercent} />
          <span className="stat-subtext">
            {totals.completedTasks} of {totals.totalTasks} populated cells detected as complete
          </span>
        </div>
      </section>

      {workbook.warning ? <div className="warning-banner">{workbook.warning}</div> : null}
      {workbook.sourceMode === "demo" ? (
        <div className="warning-banner">
          Demo mode is active because the live sheet could not be read. Check that the spreadsheet is
          published as an entire document.
        </div>
      ) : null}

      <section className="summary-grid" aria-label="Event summary">
        <SummaryCard label="Visible tabs" value={workbook.tabs.length.toString()} />
        <SummaryCard label="Completed cells" value={totals.completedTasks.toString()} />
        <SummaryCard label="Populated cells" value={totals.totalTasks.toString()} />
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
              aria-label="Search sheet"
              className="search-input"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search this tab..."
              value={query}
            />
          ) : null}
        </div>

        {activeSlug === "overview" ? (
          <Overview tabs={workbook.tabs} onSelectTab={setActiveSlug} />
        ) : activeSheet ? (
          <SheetGrid sheet={activeSheet} query={query} />
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
            <span>{tab.completedTasks} detected complete</span>
            <span>{tab.totalTasks} populated cells</span>
            <span>{tab.points} points</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function SheetGrid({ sheet, query }: { sheet: SheetData; query: string }) {
  const cleanQuery = query.trim().toLowerCase();

  const grid = useMemo(() => {
    if (!cleanQuery) {
      return sheet.grid;
    }

    return sheet.grid.map((row) =>
      row.map((cell) => ({
        ...cell,
        hiddenBySearch: cell.text.trim() && !cell.text.toLowerCase().includes(cleanQuery)
      }))
    );
  }, [cleanQuery, sheet.grid]);

  return (
    <div className="sheet-view">
      <div className="sheet-heading">
        <div>
          <p className="eyebrow">Sheet tab</p>
          <h2>{sheet.name}</h2>
        </div>
        <div className="sheet-progress">
          <strong>{sheet.completionPercent}%</strong>
          <span>{sheet.completedTasks} detected complete</span>
        </div>
      </div>

      <ProgressBar value={sheet.completionPercent} />

      <div className="sheet-grid-wrap">
        <table className="sheet-grid-table">
          <tbody>
            {grid.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {row.map((cell, columnIndex) => (
                  <SheetGridCell cell={cell} key={`${rowIndex}-${columnIndex}`} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SheetGridCell({ cell }: { cell: SheetCell & { hiddenBySearch?: boolean | string } }) {
  const className = [
    "sheet-grid-cell",
    cell.text.trim() ? "has-content" : "empty",
    cell.completed ? "complete" : "",
    cell.hiddenBySearch ? "search-dim" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <td className={className} title={cell.coordinate}>
      {cell.completed ? <span className="cell-check">✓</span> : null}
      <span>{renderValue(cell.text)}</span>
    </td>
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
    return "";
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
