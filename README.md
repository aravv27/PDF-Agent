# PDF Agent (Desktop)

A local-first desktop app for managing PDF projects, built with Electron + React + Vite, with SQLite for persistent project storage.

## Current Status

This version includes:

- Desktop app shell (Electron)
- Project sidebar with:
  - search
  - create project (`+`)
  - rename project (double-click a project name)
  - collapsible sidebar with floating `P` reopen button
- Per-project dashboard layout (UI scaffolding)
- Local SQLite persistence for projects

## Tech Stack

- Electron
- React
- Vite
- TypeScript
- SQLite (`node:sqlite` via Electron main process)

## Getting Started

## Prerequisites

- Node.js `22+`
- npm `10+`

## Install

```bash
npm install
```

## Run (Desktop Dev)

```bash
npm run desktop:dev
```

This runs:

- Vite dev server
- Electron window connected to Vite

## Build

```bash
npm run build
```

## NPM Scripts

- `npm run dev` - Vite only
- `npm run electron:dev` - Electron (expects Vite on `5173`)
- `npm run desktop:dev` - Vite + Electron together
- `npm run build` - TypeScript check + Vite build
- `npm run preview` - Preview web build
- `npm run desktop:build` - Alias for `npm run build`

## Project Data (SQLite)

Projects are stored in the Electron user data directory as:

- `pdf-agent.sqlite`

On Windows this is typically:

- `C:\Users\<your-user>\AppData\Roaming\pdf-agent\pdf-agent.sqlite`

## Database Schema (Current)

```sql
CREATE TABLE projects (
  project_id INTEGER PRIMARY KEY,
  project_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## Current Project Actions

- Create: click `Create New Project` `+` button
- Select: single-click a project in sidebar
- Rename: double-click project name, then:
  - `Enter` to save
  - click outside to save
  - `Escape` to cancel

## Important Dev Note

`Ctrl + R` reloads only the renderer (React UI).  
If you changed Electron `main`/`preload` code (IPC/backend), fully stop and restart `npm run desktop:dev`.

## Folder Structure

```txt
electron/
  main.cjs          # Electron main process + SQLite + IPC
  preload.cjs       # Secure renderer API bridge
src/
  App.tsx           # Sidebar + dashboard UI and interactions
  main.tsx          # React entry
  style.css         # App styling/layout
  desktop.d.ts      # Renderer typings for window.desktop API
```

## Roadmap (Next)

- Documents table and document attachments per project
- Popup panels for Description / Custom Instructions / Notes / Memory / Files
- PDF viewer integration (PDF.js)
- Notes, summaries, and AI workflows
