export type SheetRow = {
  id: string;
  values: string[];
  cells: Record<string, string>;
  taskName: string;
  completed: boolean;
  statusLabel: string;
  points: number;
  rowIndex?: number;
  columnIndex?: number;
  coordinate?: string;
  backgroundColor?: string;
  textColor?: string;
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
  viewMode: "board" | "table";
  columnCount?: number;
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

type ParsedCell = {
  text: string;
  rowIndex: number;
  columnIndex: number;
  coordinate: string;
  backgroundColor?: string;
  textColor?: string;
  style: string;
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

async function getPublishedWorkbook(inputUrl: string, refreshSeconds: number): Promise<EventWorkbook> {
  const base = getPublishedBaseUrl(inputUrl);
  const htmlUrl = `${base}/pubhtml`;
  const primaryHtml = await fetchText(htmlUrl, refreshSeconds);
  const widgetHtml = await fetchText(`${base}/pubhtml?widget=true&headers=false`, refreshSeconds).catch(
    () => ""
  );

  let tabs = discoverTabs(`${primaryHtml}\n${widgetHtml}`, inputUrl);
  let warning: string | undefined;

  if (tabs.length === 0) {
    const fallbackGid = inputUrl.match(/[?&#]gid=(\d+)/)?.[1] || "0";
    tabs = [{ name: "Published Sheet", gid: fallbackGid, slug: "published-sheet" }];
    warning =
      "The app could not discover all sheet tabs from the published page, so it loaded the default published tab only. Check the sheet is published as Entire document.";
  }

  const sheetData = await Promise.all(
    tabs.map(async (tab) => {
      const tabHtmlUrl = `${base}/pubhtml?gid=${encodeURIComponent(
        tab.gid
      )}&single=true&widget=true&headers=false`;
      const csvUrl = `${base}/pub?gid=${encodeURIComponent(tab.gid)}&single=true&output=csv`;

      const [html, csv] = await Promise.all([
        fetchText(tabHtmlUrl, refreshSeconds).catch(() => ""),
        fetchText(csvUrl, refreshSeconds).catch(() => "")
      ]);

      const htmlSheet = html ? htmlToSheet(tab, html) : null;
      if (htmlSheet && htmlSheet.rows.length > 0) {
        return htmlSheet;
      }

      if (!csv || looksLikeHtml(csv)) {
        throw new Error(
          `Google did not return readable sheet data for tab "${tab.name}". Check the sheet is published to the web.`
        );
      }

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
    warning:
      warning ||
      (inputUrl.includes("single=true")
        ? "The configured Google Sheet URL includes single=true. Publishing the entire document is recommended so all visible tabs can be discovered."
        : undefined),
    tabs: sheetData
  };
}

async function fetchText(url: string, refreshSeconds: number): Promise<string> {
  const response = await fetch(url, {
    next: { revalidate: refreshSeconds },
    headers: { "user-agent": "RancourSheetEventApp/1.0" }
  });

  if (!response.ok) {
    throw new Error(`Google returned ${response.status} for ${url}`);
  }

  return response.text();
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

  const addTab = (gid: string | undefined, rawName?: string) => {
    if (!gid || seen.has(gid)) {
      return;
    }

    const fallbackName = `Sheet ${tabs.length + 1}`;
    const name = cleanTabName(rawName || fallbackName) || fallbackName;

    seen.add(gid);
    tabs.push({ name, gid, slug: uniqueSlug(slugify(name), tabs) });
  };

  for (const candidateHtml of expandHtmlVariants(html)) {
    const anchorRegex = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
    let anchorMatch: RegExpExecArray | null;

    while ((anchorMatch = anchorRegex.exec(candidateHtml)) !== null) {
      const anchor = anchorMatch[0];
      const gid =
        anchor.match(/(?:#gid=|[?&]gid=)(\d+)/i)?.[1] ||
        anchor.match(/switchToSheet\((?:['"])?(\d+)(?:['"])?\)/i)?.[1];

      if (gid) {
        addTab(gid, anchor);
      }
    }

    const gidOnlyRegex =
      /(?:#gid=|[?&]gid=|gid['"]?\s*[:=]\s*['"]?|sheetId['"]?\s*[:=]\s*['"]?)(\d+)/gi;
    let gidMatch: RegExpExecArray | null;

    while ((gidMatch = gidOnlyRegex.exec(candidateHtml)) !== null) {
      addTab(gidMatch[1]);
    }
  }

  const urlGid = sourceUrl.match(/[?&#]gid=(\d+)/)?.[1];
  if (tabs.length === 0 && urlGid) {
    addTab(urlGid, "Sheet");
  }

  return tabs;
}

function htmlToSheet(tab: DiscoveredTab, html: string): SheetData | null {
  const cells = parseHtmlCells(html);

  if (cells.length === 0) {
    return null;
  }

  const rows = groupCellsByRow(cells);
  const firstRow = rows.find((row) => row.some((cell) => cell.text));

  if (firstRow && looksLikeHeaderRow(firstRow.map((cell) => cell.text))) {
    return htmlTableToSheet(tab, rows);
  }

  return htmlBoardToSheet(tab, cells);
}

function parseHtmlCells(html: string): ParsedCell[] {
  const classStyles = extractClassStyles(html);
  const tableMatch = html.match(/<table\b[\s\S]*?<\/table>/i);

  if (!tableMatch) {
    return [];
  }

  const cells: ParsedCell[] = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  let rowIndex = 0;

  while ((rowMatch = rowRegex.exec(tableMatch[0])) !== null) {
    const cellRegex = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;
    let columnIndex = 0;

    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const attributes = cellMatch[2];
      const cellHtml = cellMatch[3];
      const classes = getAttribute(attributes, "class")?.split(/\s+/).filter(Boolean) || [];
      const inlineStyle = getAttribute(attributes, "style") || "";
      const combinedStyle = [...classes.map((className) => classStyles.get(className) || ""), inlineStyle]
        .filter(Boolean)
        .join(";");
      const colspan = Number.parseInt(getAttribute(attributes, "colspan") || "1", 10);
      const span = Number.isFinite(colspan) && colspan > 0 ? colspan : 1;
      const text = cleanCellText(cellHtml);
      const backgroundColor = getStyleProperty(combinedStyle, "background-color");
      const textColor = getStyleProperty(combinedStyle, "color");

      for (let offset = 0; offset < span; offset += 1) {
        cells.push({
          text,
          rowIndex,
          columnIndex: columnIndex + offset,
          coordinate: `${columnName(columnIndex + offset)}${rowIndex + 1}`,
          backgroundColor,
          textColor,
          style: combinedStyle
        });
      }

      columnIndex += span;
    }

    rowIndex += 1;
  }

  return cells.filter((cell) => cell.text.length > 0);
}

function htmlTableToSheet(tab: DiscoveredTab, rowsByIndex: ParsedCell[][]): SheetData {
  const headerCells = rowsByIndex[0] || [];
  const headers = normaliseHeaders(headerCells.map((cell) => cell.text));
  const rows = rowsByIndex.slice(1).flatMap((cells, index) => {
    if (!cells.some((cell) => cell.text.trim())) {
      return [];
    }

    const values = headers.map((_, columnIndex) => cells.find((cell) => cell.columnIndex === columnIndex)?.text || "");
    const row = makeSheetRow(headers, values, index);
    const completedCell = cells.find((cell) => cellLooksCompleted(cell));

    row.rowIndex = cells[0]?.rowIndex;
    row.columnIndex = cells[0]?.columnIndex;
    row.coordinate = cells[0]?.coordinate;

    if (completedCell) {
      row.completed = true;
      row.statusLabel = "Completed";
      row.backgroundColor = completedCell.backgroundColor;
      row.textColor = completedCell.textColor;
    }

    return [row];
  });

  return makeSheetData(tab, headers, rows, "table");
}

function htmlBoardToSheet(tab: DiscoveredTab, cells: ParsedCell[]): SheetData {
  const tileCells = cells.filter(isLikelyTileCell);
  const rows = tileCells.map((cell, index) => {
    const completed = cellLooksCompleted(cell);
    const taskName = removeCompletionMarkers(cell.text) || cell.text;
    const points = extractPoints(cell.text);

    return {
      id: `${cell.coordinate}-${slugify(taskName)}-${index}`,
      values: [taskName, completed ? "Completed" : "Pending"],
      cells: { Tile: taskName, Status: completed ? "Completed" : "Pending" },
      taskName,
      completed,
      statusLabel: completed ? "Completed" : "Pending",
      points,
      rowIndex: cell.rowIndex,
      columnIndex: cell.columnIndex,
      coordinate: cell.coordinate,
      backgroundColor: cell.backgroundColor,
      textColor: cell.textColor
    } satisfies SheetRow;
  });

  const maxColumn = rows.reduce((max, row) => Math.max(max, row.columnIndex ?? 0), 0);
  return makeSheetData(tab, ["Tile", "Status"], rows, "board", maxColumn + 1);
}

function csvToSheet(tab: DiscoveredTab, csv: string): SheetData {
  const parsed = parseCsv(csv);
  const firstRow = parsed[0] || [];

  if (looksLikeHeaderRow(firstRow)) {
    const headers = normaliseHeaders(firstRow);
    const rows = parsed
      .slice(1)
      .filter(hasContent)
      .map((values, index) => makeSheetRow(headers, values, index));

    return makeSheetData(tab, headers, rows, "table");
  }

  const rows = parsed.flatMap((row, rowIndex) =>
    row.flatMap((value, columnIndex) => {
      const text = value.trim();
      if (!text || isIgnoredBoardText(text)) {
        return [];
      }

      const completed = textLooksCompleted(text);
      const taskName = removeCompletionMarkers(text) || text;

      return [
        {
          id: `${columnName(columnIndex)}${rowIndex + 1}-${slugify(taskName)}`,
          values: [taskName, completed ? "Completed" : "Pending"],
          cells: { Tile: taskName, Status: completed ? "Completed" : "Pending" },
          taskName,
          completed,
          statusLabel: completed ? "Completed" : "Pending",
          points: extractPoints(text),
          rowIndex,
          columnIndex,
          coordinate: `${columnName(columnIndex)}${rowIndex + 1}`
        } satisfies SheetRow
      ];
    })
  );

  const maxColumn = rows.reduce((max, row) => Math.max(max, row.columnIndex ?? 0), 0);
  return makeSheetData(tab, ["Tile", "Status"], rows, "board", maxColumn + 1);
}

function makeSheetData(
  tab: DiscoveredTab,
  headers: string[],
  rows: SheetRow[],
  viewMode: "board" | "table",
  columnCount?: number
): SheetData {
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
    completionPercent: totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100),
    points,
    viewMode,
    columnCount
  };
}

function makeSheetRow(headers: string[], values: string[], index: number): SheetRow {
  const cells = headers.reduce<Record<string, string>>((result, header, cellIndex) => {
    result[header] = (values[cellIndex] || "").trim();
    return result;
  }, {});

  const taskName = getTaskName(headers, cells, values, index);
  const completed = isCompleted(headers, cells) || textLooksCompleted(values.join(" "));
  const statusLabel = getStatusLabel(headers, cells, completed);
  const points = getPoints(headers, cells) || extractPoints(values.join(" "));

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

function getTaskName(headers: string[], cells: Record<string, string>, values: string[], index: number): string {
  const preferredHeaders = ["task", "tile", "item", "drop", "challenge", "boss", "name", "objective", "requirement"];
  const matchingHeader = headers.find((header) =>
    preferredHeaders.some((preferred) => header.toLowerCase().includes(preferred))
  );

  if (matchingHeader && cells[matchingHeader]) {
    return cells[matchingHeader];
  }

  return values.find((value) => value.trim().length > 0)?.trim() || `Row ${index + 1}`;
}

function getStatusLabel(headers: string[], cells: Record<string, string>, completed: boolean): string {
  const statusHeader = headers.find((header) =>
    ["status", "complete", "completed", "done", "approved", "submitted", "obtained"].some((term) =>
      header.toLowerCase().includes(term)
    )
  );

  if (statusHeader && cells[statusHeader]) {
    return cells[statusHeader];
  }

  return completed ? "Completed" : "Pending";
}

function isCompleted(headers: string[], cells: Record<string, string>): boolean {
  const statusHeaders = headers.filter((header) =>
    ["status", "complete", "completed", "done", "approved", "submitted", "obtained"].some((term) =>
      header.toLowerCase().includes(term)
    )
  );

  for (const header of statusHeaders) {
    const value = normaliseValue(cells[header]);

    if (!value) {
      continue;
    }

    if (
      [
        "complete",
        "completed",
        "done",
        "yes",
        "y",
        "true",
        "approved",
        "submitted",
        "claimed",
        "obtained",
        "received",
        "x",
        "✓",
        "✔",
        "✅",
        "1"
      ].includes(value)
    ) {
      return true;
    }

    if (["pending", "not started", "incomplete", "no", "n", "false", "rejected", "0"].includes(value)) {
      return false;
    }
  }

  return false;
}

function getPoints(headers: string[], cells: Record<string, string>): number {
  const pointsHeader = headers.find((header) =>
    ["points", "score", "value"].some((term) => header.toLowerCase().includes(term))
  );

  return pointsHeader ? parseNumber(cells[pointsHeader]) : 0;
}

function cellLooksCompleted(cell: ParsedCell): boolean {
  if (textLooksCompleted(cell.text)) {
    return true;
  }

  const style = cell.style.toLowerCase();
  if (style.includes("line-through")) {
    return true;
  }

  const background = parseColour(cell.backgroundColor);
  if (!background) {
    return false;
  }

  const strongGreen = background.g > 120 && background.g > background.r + 25 && background.g > background.b + 25;
  const strongRed = background.r > 120 && background.r > background.g + 25 && background.r > background.b + 25;

  return strongGreen || strongRed;
}

function textLooksCompleted(value: string): boolean {
  const normalised = normaliseValue(value);

  if (!normalised) {
    return false;
  }

  if (/^(true|yes|y|x|1|complete|completed|done|approved|submitted|obtained|claimed)$/.test(normalised)) {
    return true;
  }

  if (/(^|\s)(✅|✓|✔|☑|\[x\])($|\s)/i.test(value)) {
    return true;
  }

  if (/^(complete|completed|done|approved)\s*[:\-]/i.test(value.trim())) {
    return true;
  }

  return false;
}

function extractPoints(value: string): number {
  const match = value.match(/(?:^|\D)(\d{1,4})\s*(?:pts?|points?)(?:\D|$)/i);
  return match ? parseNumber(match[1]) : 0;
}

function parseNumber(value: string | undefined): number {
  const raw = value?.replace(/,/g, "") || "";
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function looksLikeHeaderRow(headers: string[]): boolean {
  const text = headers.join(" ").toLowerCase();
  const hasTaskColumn = ["task", "tile", "item", "drop", "challenge", "boss", "objective"].some((term) =>
    text.includes(term)
  );
  const hasStatusColumn = ["status", "complete", "completed", "done", "approved"].some((term) =>
    text.includes(term)
  );
  const hasStructuredColumn = ["points", "score", "submitted", "screenshot", "notes"].some((term) =>
    text.includes(term)
  );

  return hasTaskColumn && (hasStatusColumn || hasStructuredColumn);
}

function isLikelyTileCell(cell: ParsedCell): boolean {
  const text = cell.text.trim();
  return Boolean(text && !isIgnoredBoardText(text));
}

function isIgnoredBoardText(value: string): boolean {
  const normalised = normaliseValue(value).replace(/:$/, "");

  if (!normalised || /^\d+$/.test(normalised)) {
    return true;
  }

  return [
    "task",
    "tasks",
    "tile",
    "tiles",
    "status",
    "completed",
    "complete",
    "pending",
    "points",
    "score",
    "team",
    "teams",
    "total",
    "totals",
    "overview",
    "bingo"
  ].includes(normalised);
}

function removeCompletionMarkers(value: string): string {
  return value
    .replace(/(^|\s)(✅|✓|✔|☑|\[x\])/gi, " ")
    .replace(/^(complete|completed|done|approved)\s*[:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function groupCellsByRow(cells: ParsedCell[]): ParsedCell[][] {
  const grouped = new Map<number, ParsedCell[]>();

  for (const cell of cells) {
    const row = grouped.get(cell.rowIndex) || [];
    row.push(cell);
    grouped.set(cell.rowIndex, row);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left - right)
    .map(([, row]) => row.sort((left, right) => left.columnIndex - right.columnIndex));
}

function extractClassStyles(html: string): Map<string, string> {
  const styles = new Map<string, string>();
  const styleBlocks = html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || [];

  for (const block of styleBlocks) {
    const css = block.replace(/<style\b[^>]*>/i, "").replace(/<\/style>/i, "");
    const ruleRegex = /\.([a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g;
    let ruleMatch: RegExpExecArray | null;

    while ((ruleMatch = ruleRegex.exec(css)) !== null) {
      styles.set(ruleMatch[1], ruleMatch[2]);
    }
  }

  return styles;
}

function getAttribute(attributes: string, name: string): string | undefined {
  const regex = new RegExp(`${name}=(['"])(.*?)\\1`, "i");
  return attributes.match(regex)?.[2];
}

function getStyleProperty(style: string, property: string): string | undefined {
  const regex = new RegExp(`${property}\\s*:\\s*([^;]+)`, "i");
  return style.match(regex)?.[1]?.trim();
}

function parseColour(value?: string): { r: number; g: number; b: number } | null {
  if (!value) {
    return null;
  }

  const hex = value.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    const raw = hex[1];
    const expanded = raw.length === 3 ? raw.split("").map((char) => `${char}${char}`).join("") : raw;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16)
    };
  }

  const rgb = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) {
    return {
      r: Number.parseInt(rgb[1], 10),
      g: Number.parseInt(rgb[2], 10),
      b: Number.parseInt(rgb[3], 10)
    };
  }

  return null;
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

function uniqueSlug(baseSlug: string, existingTabs: DiscoveredTab[]): string {
  let slug = baseSlug;
  let counter = 2;

  while (existingTabs.some((tab) => tab.slug === slug)) {
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  return slug;
}

function columnName(index: number): string {
  let value = "";
  let number = index + 1;

  while (number > 0) {
    const remainder = (number - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    number = Math.floor((number - 1) / 26);
  }

  return value;
}

function cleanCellText(value: string): string {
  return decodeHtml(
    value
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number: string) => String.fromCharCode(Number.parseInt(number, 10)));
}

function cleanTabName(value: string): string {
  const cleaned = decodeHtml(stripTags(value)).replace(/\s+/g, " ").trim();

  try {
    return decodeURIComponent(cleaned);
  } catch {
    return cleaned;
  }
}

function expandHtmlVariants(value: string): string[] {
  const variants = new Set<string>();
  variants.add(value);
  variants.add(decodeHtml(value));
  variants.add(normalisePublishedHtml(value));
  variants.add(normalisePublishedHtml(decodeHtml(value)));
  return Array.from(variants);
}

function normalisePublishedHtml(value: string): string {
  return value
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}

function looksLikeHtml(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html") || trimmed.includes("<title>") || trimmed.includes("<body");
}

function getRefreshSeconds(): number {
  const parsed = Number.parseInt(process.env.REFRESH_SECONDS || "60", 10);
  return Number.isFinite(parsed) && parsed >= 10 ? parsed : 60;
}

function createDemoWorkbook(refreshSeconds: number, warning?: string): EventWorkbook {
  const tabs: SheetData[] = [
    createDemoSheet("Team A", "123", [
      ["✅ Bandos Hilt", "Dexterous Prayer Scroll", "Enhanced Crystal Weapon Seed"],
      ["Abyssal Whip", "✔ Zulrah Unique", "Chambers Purple"],
      ["Armadyl Helmet", "Dragon Warhammer", "Complete: Theatre Purple"]
    ]),
    createDemoSheet("Team B", "456", [
      ["Abyssal Whip", "Zulrah Unique", "Chambers Purple"],
      ["✅ Berserker Ring", "Godsword Shard", "Dragon Pickaxe"],
      ["Barrows Unique", "Completed: Zenyte", "DWH"]
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
