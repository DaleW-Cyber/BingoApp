export type SheetRow = {
  id: string;
  values: string[];
  cells: Record<string, string>;
  taskName: string;
  completed: boolean;
  statusLabel: string;
  points: number;
};

export type SheetData = {
  name: string;
  gid: string;
  slug: string;
  headers: string[];
  rows: SheetRow[];
  totalTasks: number;
  completedTasks: number;
  completionPercent: number;
  points: number;
};

export type EventWorkbook = {
  eventName: string;
  clanName: string;
  generatedAt: string;
  refreshSeconds: number;
  sourceMode: "published-google-sheet" | "demo";
  sourceUrl?: string;
  warning?: string;
  tabs: SheetData[];
};

type DiscoveredTab = {
  name: string;
  gid: string;
  slug: string;
};

type CacheEntry = {
  expiresAt: number;
  data: EventWorkbook;
};

let workbookCache: CacheEntry | null = null;

export async function getWorkbook(): Promise<EventWorkbook> {
  const refreshSeconds = getRefreshSeconds();
  const now = Date.now();

  if (workbookCache && workbookCache.expiresAt > now) {
    return workbookCache.data;
  }

  const publishedUrl = process.env.PUBLISHED_SHEET_URL?.trim();

  let workbook: EventWorkbook;

  if (!publishedUrl) {
    workbook = createDemoWorkbook(refreshSeconds);
  } else {
    try {
      workbook = await getPublishedWorkbook(publishedUrl, refreshSeconds);
    } catch (error) {
      workbook = createDemoWorkbook(
        refreshSeconds,
        `Unable to read the published Google Sheet. Showing demo data instead. ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  workbookCache = {
    expiresAt: now + refreshSeconds * 1000,
    data: workbook
  };

  return workbook;
}

async function getPublishedWorkbook(
  inputUrl: string,
  refreshSeconds: number
): Promise<EventWorkbook> {
  const htmlUrl = toPublishedHtmlUrl(inputUrl);
  const html = await fetchText(htmlUrl, refreshSeconds);
  const tabs = discoverTabs(html, inputUrl);

  if (tabs.length === 0) {
    throw new Error(
      "No sheet tabs were discovered. Make sure the sheet is published to the web."
    );
  }

  const base = getPublishedBaseUrl(inputUrl);
  const sheetData = await Promise.all(
    tabs.map(async (tab) => {
      const csvUrl = `${base}/pub?gid=${encodeURIComponent(
        tab.gid
      )}&single=true&output=csv`;
      const csv = await fetchText(csvUrl, refreshSeconds);
      return csvToSheet(tab, csv);
    })
  );

  return {
    eventName: process.env.NEXT_PUBLIC_EVENT_NAME || "Rancour Event Tracker",
    clanName: process.env.NEXT_PUBLIC_CLAN_NAME || "Rancour PvM",
    generatedAt: new Date().toISOString(),
    refreshSeconds,
    sourceMode: "published-google-sheet",
    sourceUrl: htmlUrl,
    warning: inputUrl.includes("single=true")
      ? "The configured Google Sheet URL includes single=true. The app will try to discover all published tabs, but publishing the entire document is recommended."
      : undefined,
    tabs: sheetData
  };
}

async function fetchText(url: string, refreshSeconds: number): Promise<string> {
  const response = await fetch(url, {
    next: { revalidate: refreshSeconds },
    headers: {
      "user-agent": "RancourSheetEventApp/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Google returned ${response.status} for ${url}`);
  }

  return response.text();
}

function toPublishedHtmlUrl(inputUrl: string): string {
  const base = getPublishedBaseUrl(inputUrl);
  return `${base}/pubhtml`;
}

function getPublishedBaseUrl(inputUrl: string): string {
  const cleaned = inputUrl.trim();

  if (cleaned.includes("/pubhtml")) {
    return cleaned.split("/pubhtml")[0];
  }

  if (cleaned.includes("/pub?")) {
    return cleaned.split("/pub?")[0];
  }

  if (cleaned.endsWith("/pub")) {
    return cleaned.slice(0, -4);
  }

  return cleaned.replace(/\/+$/, "");
}

function discoverTabs(html: string, sourceUrl: string): DiscoveredTab[] {
  const tabs: DiscoveredTab[] = [];
  const seen = new Set<string>();

  const linkRegex = /<a[^>]*href=["'][^"']*(?:#gid=|gid=)(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const gid = match[1];
    const name = decodeHtml(stripTags(match[2])).trim();

    if (!gid || !name || seen.has(gid)) {
      continue;
    }

    seen.add(gid);
    tabs.push({ name, gid, slug: slugify(name) });
  }

  const urlGid = sourceUrl.match(/[?&#]gid=(\d+)/)?.[1];
  if (tabs.length === 0 && urlGid) {
    tabs.push({ name: "Sheet", gid: urlGid, slug: "sheet" });
  }

  return tabs;
}

function csvToSheet(tab: DiscoveredTab, csv: string): SheetData {
  const parsed = parseCsv(csv);
  const headerRow = parsed[0] || [];
  const headers = normaliseHeaders(headerRow);
  const dataRows = parsed.slice(1).filter((row) => hasContent(row));

  const rows = dataRows.map((values, index) => makeSheetRow(headers, values, index));
  const totalTasks = rows.length;
  const completedTasks = rows.filter((row) => row.completed).length;
  const points = rows.reduce((total, row) => total + row.points, 0);

  return {
    name: tab.name,
    gid: tab.gid,
    slug: tab.slug,
    headers,
    rows,
    totalTasks,
    completedTasks,
    completionPercent:
      totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100),
    points
  };
}

function makeSheetRow(headers: string[], values: string[], index: number): SheetRow {
  const cells = headers.reduce<Record<string, string>>((result, header, cellIndex) => {
    result[header] = (values[cellIndex] || "").trim();
    return result;
  }, {});

  const taskName = getTaskName(headers, cells, values, index);
  const completed = isCompleted(headers, cells);
  const statusLabel = getStatusLabel(headers, cells, completed);
  const points = getPoints(headers, cells);

  return {
    id: `${index}-${slugify(taskName)}`,
    values: headers.map((header) => cells[header] || ""),
    cells,
    taskName,
    completed,
    statusLabel,
    points
  };
}

function getTaskName(
  headers: string[],
  cells: Record<string, string>,
  values: string[],
  index: number
): string {
  const preferredHeaders = [
    "task",
    "tile",
    "item",
    "drop",
    "challenge",
    "boss",
    "name",
    "objective",
    "requirement"
  ];

  const matchingHeader = headers.find((header) =>
    preferredHeaders.some((preferred) => header.toLowerCase().includes(preferred))
  );

  if (matchingHeader && cells[matchingHeader]) {
    return cells[matchingHeader];
  }

  return values.find((value) => value.trim().length > 0)?.trim() || `Row ${index + 1}`;
}

function getStatusLabel(
  headers: string[],
  cells: Record<string, string>,
  completed: boolean
): string {
  const statusHeader = headers.find((header) =>
    ["status", "complete", "completed", "done", "approved", "submitted", "obtained"].some(
      (term) => header.toLowerCase().includes(term)
    )
  );

  if (statusHeader && cells[statusHeader]) {
    return cells[statusHeader];
  }

  return completed ? "Completed" : "Pending";
}

function isCompleted(headers: string[], cells: Record<string, string>): boolean {
  const statusHeaders = headers.filter((header) =>
    ["status", "complete", "completed", "done", "approved", "submitted", "obtained"].some(
      (term) => header.toLowerCase().includes(term)
    )
  );

  for (const header of statusHeaders) {
    const value = normaliseValue(cells[header]);

    if (!value) {
      continue;
    }

    if (
      ["complete", "completed", "done", "yes", "y", "true", "approved", "submitted", "claimed", "obtained", "received", "x", "✓", "✔", "1"].includes(value)
    ) {
      return true;
    }

    if (
      ["pending", "not started", "incomplete", "no", "n", "false", "rejected", "0"].includes(value)
    ) {
      return false;
    }
  }

  return false;
}

function getPoints(headers: string[], cells: Record<string, string>): number {
  const pointsHeader = headers.find((header) =>
    ["points", "score", "value"].some((term) => header.toLowerCase().includes(term))
  );

  if (!pointsHeader) {
    return 0;
  }

  const raw = cells[pointsHeader]?.replace(/,/g, "") || "";
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = "";
  let insideQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    const nextCharacter = csv[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentValue += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === "," && !insideQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += character;
  }

  currentRow.push(currentValue);
  rows.push(currentRow);

  return rows.filter((row) => row.some((value) => value.trim().length > 0));
}

function normaliseHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>();

  return headers.map((header, index) => {
    const baseName = header.trim() || `Column ${index + 1}`;
    const count = counts.get(baseName) || 0;
    counts.set(baseName, count + 1);
    return count === 0 ? baseName : `${baseName} ${count + 1}`;
  });
}

function hasContent(row: string[]): boolean {
  return row.some((value) => value.trim().length > 0);
}

function normaliseValue(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return slug || "sheet";
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getRefreshSeconds(): number {
  const parsed = Number.parseInt(process.env.REFRESH_SECONDS || "60", 10);
  return Number.isFinite(parsed) && parsed >= 10 ? parsed : 60;
}

function createDemoWorkbook(refreshSeconds: number, warning?: string): EventWorkbook {
  const tabs: SheetData[] = [
    createDemoSheet("Overview", "0", [
      ["Task", "Status", "Points", "Submitted By", "Notes"],
      ["Open event", "Completed", "10", "Dale", "Event started"],
      ["First rare drop", "Completed", "25", "Team A", "Screenshot approved"],
      ["Final boss tile", "Pending", "50", "", "Waiting for completion"]
    ]),
    createDemoSheet("Team A", "123", [
      ["Task", "Status", "Points", "Submitted By", "Screenshot"],
      ["Bandos Hilt", "Completed", "15", "Player 1", ""],
      ["Dexterous Prayer Scroll", "Completed", "20", "Player 2", ""],
      ["Enhanced Crystal Weapon Seed", "Pending", "40", "", ""]
    ]),
    createDemoSheet("Team B", "456", [
      ["Task", "Status", "Points", "Submitted By", "Screenshot"],
      ["Abyssal Whip", "Completed", "10", "Player 3", ""],
      ["Zulrah Unique", "Pending", "15", "", ""],
      ["Chambers Purple", "Pending", "30", "", ""]
    ])
  ];

  return {
    eventName: process.env.NEXT_PUBLIC_EVENT_NAME || "Rancour Event Tracker",
    clanName: process.env.NEXT_PUBLIC_CLAN_NAME || "Rancour PvM",
    generatedAt: new Date().toISOString(),
    refreshSeconds,
    sourceMode: "demo",
    warning,
    tabs
  };
}

function createDemoSheet(name: string, gid: string, data: string[][]): SheetData {
  return csvToSheet(
    { name, gid, slug: slugify(name) },
    data.map((row) => row.map(escapeCsvValue).join(",")).join("\n")
  );
}

function escapeCsvValue(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}
