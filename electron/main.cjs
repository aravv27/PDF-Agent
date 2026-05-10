const path = require('node:path')
const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { app, BrowserWindow, dialog, ipcMain } = require('electron')

const isDev = !app.isPackaged
let db = null

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'pdf-agent.sqlite')
  db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      project_id INTEGER PRIMARY KEY,
      project_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      document_id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL,
      document_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );
  `)
}

function mapProjectRow(row) {
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDocumentRow(row) {
  return {
    documentId: row.document_id,
    projectId: row.project_id,
    documentName: row.document_name,
    filePath: row.file_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function loadWindow(win, hash = '') {
  if (isDev) {
    const hashSuffix = hash ? `#${hash}` : ''
    win.loadURL(`http://localhost:5173/${hashSuffix}`)
    return
  }

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash })
}

function createReaderWindow(documentId) {
  const readerWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    autoHideMenuBar: true,
    title: 'PDF Reader',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  loadWindow(readerWindow, `reader/${documentId}`)
}

function setupIpcHandlers() {
  ipcMain.handle('projects:list', () => {
    const statement = db.prepare(`
      SELECT project_id, project_name, created_at, updated_at
      FROM projects
      ORDER BY updated_at DESC, project_id DESC
    `)

    return statement.all().map(mapProjectRow)
  })

  ipcMain.handle('projects:create', (_event, projectName) => {
    const name = String(projectName ?? '').trim()
    if (!name) {
      throw new Error('Project name cannot be empty.')
    }

    const now = new Date().toISOString()
    const insert = db.prepare(`
      INSERT INTO projects (project_name, created_at, updated_at)
      VALUES (?, ?, ?)
    `)
    const result = insert.run(name, now, now)
    const projectId = Number(result.lastInsertRowid)

    const select = db.prepare(`
      SELECT project_id, project_name, created_at, updated_at
      FROM projects
      WHERE project_id = ?
    `)
    const row = select.get(projectId)
    return mapProjectRow(row)
  })

  ipcMain.handle('projects:rename', (_event, projectId, projectName) => {
    const id = Number(projectId)
    const name = String(projectName ?? '').trim()

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid project id.')
    }

    if (!name) {
      throw new Error('Project name cannot be empty.')
    }

    const now = new Date().toISOString()
    const update = db.prepare(`
      UPDATE projects
      SET project_name = ?, updated_at = ?
      WHERE project_id = ?
    `)
    const result = update.run(name, now, id)

    if (result.changes === 0) {
      throw new Error('Project not found.')
    }

    const select = db.prepare(`
      SELECT project_id, project_name, created_at, updated_at
      FROM projects
      WHERE project_id = ?
    `)
    const row = select.get(id)
    return mapProjectRow(row)
  })

  ipcMain.handle('documents:list', (_event, projectId) => {
    const id = Number(projectId)
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid project id.')
    }

    const statement = db.prepare(`
      SELECT document_id, project_id, document_name, file_path, created_at, updated_at
      FROM documents
      WHERE project_id = ?
      ORDER BY updated_at DESC, document_id DESC
    `)

    return statement.all(id).map(mapDocumentRow)
  })

  ipcMain.handle('documents:add-from-dialog', async (_event, projectId) => {
    const id = Number(projectId)
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid project id.')
    }

    const projectExists = db
      .prepare('SELECT project_id FROM projects WHERE project_id = ?')
      .get(id)
    if (!projectExists) {
      throw new Error('Project not found.')
    }

    const fileSelection = await dialog.showOpenDialog({
      title: 'Select PDF document',
      properties: ['openFile'],
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    })

    if (fileSelection.canceled || fileSelection.filePaths.length === 0) {
      return null
    }

    const sourcePath = fileSelection.filePaths[0]
    const sourceExt = path.extname(sourcePath).toLowerCase()
    if (sourceExt !== '.pdf') {
      throw new Error('Only PDF files are supported.')
    }

    const sourceBaseName = path.basename(sourcePath, sourceExt)
    const documentName = sourceBaseName || 'Untitled Document'
    const projectFolder = path.join(app.getPath('userData'), 'projects', String(id), 'documents')
    fs.mkdirSync(projectFolder, { recursive: true })

    const storedFileName = `${Date.now()}-${randomUUID()}.pdf`
    const targetPath = path.join(projectFolder, storedFileName)
    fs.copyFileSync(sourcePath, targetPath)

    const now = new Date().toISOString()
    const insert = db.prepare(`
      INSERT INTO documents (project_id, document_name, file_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    const result = insert.run(id, documentName, targetPath, now, now)
    const documentId = Number(result.lastInsertRowid)

    db.prepare('UPDATE projects SET updated_at = ? WHERE project_id = ?').run(now, id)

    const row = db
      .prepare(`
        SELECT document_id, project_id, document_name, file_path, created_at, updated_at
        FROM documents
        WHERE document_id = ?
      `)
      .get(documentId)

    return mapDocumentRow(row)
  })

  ipcMain.handle('documents:get-by-id', (_event, documentId) => {
    const id = Number(documentId)
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid document id.')
    }

    const row = db
      .prepare(`
        SELECT document_id, project_id, document_name, file_path, created_at, updated_at
        FROM documents
        WHERE document_id = ?
      `)
      .get(id)

    if (!row) {
      return null
    }

    return mapDocumentRow(row)
  })

  ipcMain.handle('documents:read-bytes', (_event, documentId) => {
    const id = Number(documentId)
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid document id.')
    }

    const row = db
      .prepare('SELECT file_path FROM documents WHERE document_id = ?')
      .get(id)

    if (!row) {
      throw new Error('Document not found.')
    }

    if (!fs.existsSync(row.file_path)) {
      throw new Error('Document file is missing.')
    }

    const bytes = fs.readFileSync(row.file_path)
    return bytes
  })

  ipcMain.handle('documents:open-reader', (_event, documentId) => {
    const id = Number(documentId)
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid document id.')
    }

    const row = db
      .prepare('SELECT document_id FROM documents WHERE document_id = ?')
      .get(id)
    if (!row) {
      throw new Error('Document not found.')
    }

    createReaderWindow(id)
    return true
  })
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  loadWindow(mainWindow)
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' })
}

app.whenReady().then(() => {
  initDatabase()
  setupIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (db) {
    db.close()
    db = null
  }
})
