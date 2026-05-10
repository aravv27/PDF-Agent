# PDF Agent (Desktop)

A local-first desktop app for managing PDF projects and extracting document context, built with Electron, React, Vite, and SQLite.

## Current Status

This version is a fully functional PDF management system featuring:

- **Multi-Window Architecture**: Spawns independent reader windows for documents.
- **Project Management**: 
  - Search, create, and rename projects.
  - Persistent storage via SQLite.
  - Collapsible sidebar with quick-access floating button.
- **Document Management**:
  - Add PDFs to projects (files are copied to local app data for persistence).
  - Per-project document lists.
- **Advanced PDF Reader**:
  - **Rendering**: Canvas-based rendering with lazy loading (Intersection Observer) and HiDPI support.
  - **Interaction**: Full text selection layer and annotation/link support.
  - **Navigation**: Sidebar with generated thumbnails and interactive document outline.
  - **Search**: Real-time text search with hit highlighting and prev/next navigation.
  - **View Controls**: Zoom (Actual, Fit Width, Fit Page, Custom) and 90° rotation.
  - **Context Extraction**: "Export Context" feature to dump page text and coordinate data to a JSON file for downstream AI workflows.

## Tech Stack

- **Framework**: React 19 (TypeScript)
- **Runtime**: Electron 42
- **Build Tool**: Vite 8
- **Database**: SQLite (`node:sqlite` via Electron main process)
- **PDF Engine**: PDF.js (`pdfjs-dist`)
- **Styling**: Vanilla CSS with modern aesthetics (gradients, glassmorphism, responsive dashboard).

## Getting Started

### Prerequisites

- Node.js `22+`
- npm `10+`

### Install

```bash
npm install
```

### Run (Desktop Dev)

```bash
npm run desktop:dev
```

This runs the Vite dev server and the Electron main process concurrently.

## Project Data (SQLite)

Data is stored in the Electron user data directory:
- Database: `pdf-agent.sqlite`
- Files: `projects/<project_id>/documents/`

On Windows: `C:\Users\<user>\AppData\Roaming\pdf-agent\`

### Database Schema

```sql
CREATE TABLE projects (
  project_id INTEGER PRIMARY KEY,
  project_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE documents (
  document_id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  document_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
```

## Folder Structure

```txt
electron/
  main.cjs          # Main process: Window management, SQLite, IPC handlers
  preload.cjs       # Secure bridge for desktop API (projects, documents, fs)
src/
  main.tsx          # React entry with hash-based routing (#reader/<id>)
  App.tsx           # Project dashboard and sidebar UI
  ReaderApp.tsx     # Feature-rich PDF viewer component
  style.css         # Unified design system and layout
  desktop.d.ts      # TypeScript definitions for the window.desktop API
```

## Roadmap

- [ ] Agent integration (AI workflows using exported context)
- [ ] Memory panel implementation
- [ ] Custom instructions and project-specific notes
- [ ] Drag-and-drop document upload
