"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EventWorkbook, SheetData, SheetRow } from "@/lib/sheets";

type FetchState = "loading" | "ready" | "error";

export default function EventDashboard() {
  const [workbook, setWorkbook] = useState<EventWorkbook | null>(null);
  const [status, setStatus] = useState<FetchState>("loading");
  const [activeSlug, setActiveSlug] = useState<string>("overview");
  const [query, setQuery] = useState("");
  const [showTable, setShowTable] = useState(false);
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
      [row.taskName, row.statusLabel, row.coordinate, ...row.values]
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
            Live event progress powered by Google Sheets. Completed tiles are detected from
            checkboxes, completed status values, tick symbols, strikethrough, and strong completed
            cell colours.
          </p>
        </div>

        <div className="hero-stat-card">
          <span className="stat-label">Overall progress</span>
          <strong>{totals.completionPercent}%</strong>
          <ProgressBar value={totals.completionPercent} />
          <span className="stat-subtext">
            {totals.completedTasks} of {totals.totalTasks} tracked tiles complete
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
        <SummaryCard label="Completed" value={totals.completedTasks.toString()} />
        <SummaryCard label="Total tiles" value={totals.totalTasks.toString()} />
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
                onClick={() => {
                  setActiveSlug(tab.slug);
                  setShowTable(false);
                }}
                type="button"
              >
                {tab.name}
              </button>
            ))}
          </div>

          {activeSlug !== "overview" ? (
            <div className="toolbar-actions">
              <input
                aria-label="Search tiles"
                className="search-input"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tiles..."
                value={query}
              />
              <button className="ghost-button" onClick={() => setShowTable((value) => !value)} type="button">
                {showTable ? "Show board" : "Show table"}
              </button>
            </div>
          ) : null}
        </div>

        {activeSlug === "overview" ? (
          <Overview tabs={workbook.tabs} onSelectTab={setActiveSlug} />
        ) : activeSheet ? (
          <SheetView rows={filteredRows} sheet={activeSheet} showTable={showTable} />
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
            <span>{tab.totalTasks} tiles</span>
            <span>{tab.points} points</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function SheetView({ sheet, rows, showTable }: { sheet: SheetData; rows: SheetRow[]; showTable: boolean }) {
  const boardRows = useMemo(() => rows.slice().sort(sortRowsByPosition), [rows]);

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

      {showTable ? <TableView rows={rows} sheet={sheet} /> : <TileBoard rows={boardRows} />}
    </div>
  );
}

function TileBoard({ rows }: { rows: SheetRow[] }) {
  if (rows.length === 0) {
    return <p className="muted">No tiles were found on this sheet tab.</p>;
  }

  return (
    <div className="tile-board">
      {rows.map((row) => (
        <article className={row.completed ? "tile-card complete" : "tile-card"} key={row.id}>
          <div className="tile-topline">
            <span className="tile-coordinate">{row.coordinate || "Tile"}</span>
            <StatusPill completed={row.completed} label={row.statusLabel} />
          </div>
          <h3>{renderValue(row.taskName)}</h3>
          {row.points > 0 ? <span className="points-badge">{row.points} pts</span> : null}
        </article>
      ))}
    </div>
  );
}

function TableView({ sheet, rows }: { sheet: SheetData; rows: SheetRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Tile</th>
            {sheet.headers
              .filter((header) => !["Tile", "Status"].includes(header))
              .map((header) => (
                <th key={header}>{header}</th>
              ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className={row.completed ? "row-complete" : undefined} key={row.id}>
              <td>
                <StatusPill completed={row.completed} label={row.statusLabel} />
              </td>
              <td>{renderValue(row.taskName)}</td>
              {sheet.headers
                .filter((header) => !["Tile", "Status"].includes(header))
                .map((header) => (
                  <td key={header}>{renderValue(row.cells[header])}</td>
                ))}
            </tr>
          ))}
        </tbody>
      </table>
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
  return <span className={completed ? "status-pill complete" : "status-pill"}>{completed ? "✓ " : ""}{label}</span>;
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

function sortRowsByPosition(left: SheetRow, right: SheetRow): number {
  const leftRow = left.rowIndex ?? 0;
  const rightRow = right.rowIndex ?? 0;

  if (leftRow !== rightRow) {
    return leftRow - rightRow;
  }

  return (left.columnIndex ?? 0) - (right.columnIndex ?? 0);
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
