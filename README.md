# Rancour Sheet Event App

A black and red event tracker for clan events where Google Sheets remains the source of truth.

The app reads a published Google Sheet, discovers the visible sheet tabs, fetches each tab as CSV, then renders them as a cleaner web app with progress cards, tab navigation, task cards, and a fallback table view.

## Features

- Google Sheets powered
- Supports multiple visible tabs
- Each visible tab appears in the website navigation
- Black and red Rancour-style branding
- Overview dashboard
- Per-tab progress cards
- Task cards and table view
- Auto-refreshes while the sheet remains the source of truth
- Railway-ready
- Demo mode when no sheet is configured

## How the data works

The app expects a published Google Sheet URL.

For best results, publish the **entire document**, not a single tab.

In Google Sheets:

1. Open the event spreadsheet.
2. Select **File**.
3. Select **Share**.
4. Select **Publish to web**.
5. Choose **Entire document**.
6. Choose **Web page**.
7. Copy the published URL.

A good URL usually looks like this:

```text
https://docs.google.com/spreadsheets/d/e/YOUR_PUBLISHED_SHEET_ID/pubhtml
```

A single-tab URL usually contains this:

```text
gid=0&single=true
```

The app can try to read from a single-tab URL, but it cannot reliably discover every visible tab unless the whole spreadsheet is published.

## Recommended sheet layout

The app can render most tabular data, but it works best with clear headers.

Recommended headers:

```text
Task | Status | Points | Submitted By | Completed At | Screenshot | Notes
```

Status values detected as complete include:

```text
Completed, Complete, Done, Yes, TRUE, Approved, Submitted, Claimed, Obtained, Received, X, ✓, ✔, 1
```

Status values detected as incomplete include:

```text
Pending, Not Started, Incomplete, No, FALSE, Rejected, 0
```

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

## Environment variables

Create `.env.local` for local development, or set these in Railway.

```env
PUBLISHED_SHEET_URL="https://docs.google.com/spreadsheets/d/e/YOUR_PUBLISHED_SHEET_ID/pubhtml"
NEXT_PUBLIC_EVENT_NAME="Rancour Spring Bingo 2026"
NEXT_PUBLIC_CLAN_NAME="Rancour PvM"
REFRESH_SECONDS="60"
```

### `PUBLISHED_SHEET_URL`

The published Google Sheet URL.

Use the whole-document published URL where possible.

### `NEXT_PUBLIC_EVENT_NAME`

The title shown at the top of the app.

### `NEXT_PUBLIC_CLAN_NAME`

The clan or community name shown above the event title.

### `REFRESH_SECONDS`

How often the server cache should refresh. The client also reloads data automatically.

Minimum recommended value: `60`.

## Publishing to GitHub

Create a new GitHub repo, then run:

```bash
git init
git add .
git commit -m "Initial Rancour sheet event app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

## Deploying to Railway

1. Push this project to GitHub.
2. Open Railway.
3. Create a new project.
4. Select **Deploy from GitHub repo**.
5. Choose this repository.
6. Add the environment variables from the section above.
7. Deploy.

Railway should detect the Next.js app automatically.

## Updating for each new event

For a new event, you do not need to rebuild the website.

Either:

- Reuse the same Google Sheet and clear/update the data; or
- Publish the new event sheet and update `PUBLISHED_SHEET_URL` in Railway.

You can also change:

```env
NEXT_PUBLIC_EVENT_NAME="New Event Name"
```

Then redeploy or restart the Railway service.

## Notes for clan event sheets

For the most reliable results:

- Keep the first row as headers.
- Use one tab per team if you want each team to appear separately.
- Hide any tabs that should not appear publicly.
- Avoid merged cells in public-facing tabs.
- Put calculated values in normal cells rather than relying only on formatting.
- Use clear status words such as `Completed` or `Pending`.

## Current limitations

- The app reads published sheet data, not private spreadsheets.
- Google may take a short time to update published sheet output after a change.
- Heavy formatting from Sheets is not copied; the app uses its own styling.
- Complex bingo boards with merged cells may need a standardised export tab for best results.
