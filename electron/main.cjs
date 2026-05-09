const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { app, BrowserWindow, ipcMain } = require('electron')

const isDev = !app.isPackaged
let db = null

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'pdf-agent.sqlite')
  db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      project_id INTEGER PRIMARY KEY,
      project_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
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
