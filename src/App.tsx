import './style.css'
import { useEffect, useMemo, useState } from 'react'

type ProjectRecord = {
  projectId: number
  projectName: string
  createdAt: string
  updatedAt: string
}

type DocumentRecord = {
  documentId: number
  projectId: number
  documentName: string
  filePath: string
  createdAt: string
  updatedAt: string
}

function getNextProjectName(projects: ProjectRecord[]) {
  const baseName = 'Untitled Project'
  const names = new Set(projects.map((project) => project.projectName))

  if (!names.has(baseName)) {
    return baseName
  }

  let index = 2
  while (names.has(`${baseName} ${index}`)) {
    index += 1
  }

  return `${baseName} ${index}`
}

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isAddingDocument, setIsAddingDocument] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [isSavingRename, setIsSavingRename] = useState(false)
  const [projectError, setProjectError] = useState('')
  const [documentError, setDocumentError] = useState('')

  useEffect(() => {
    const loadProjects = async () => {
      const projectRows = await window.desktop.listProjects()
      setProjects(projectRows)
    }

    void loadProjects()
  }, [])

  useEffect(() => {
    if (selectedProjectId !== null) return
    if (projects.length === 0) return
    setSelectedProjectId(projects[0].projectId)
  }, [projects, selectedProjectId])

  useEffect(() => {
    if (selectedProjectId === null) {
      setDocuments([])
      return
    }

    const loadDocuments = async () => {
      const rows = await window.desktop.listDocuments(selectedProjectId)
      setDocuments(rows)
    }

    void loadDocuments()
  }, [selectedProjectId])

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return projects

    return projects.filter((project) =>
      project.projectName.toLowerCase().includes(query),
    )
  }, [projects, searchQuery])

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )

  const handleCreateProject = async () => {
    if (isCreating) return

    setIsCreating(true)
    try {
      const projectName = getNextProjectName(projects)
      const createdProject = await window.desktop.createProject(projectName)
      setProjects((current) => [createdProject, ...current])
      setSelectedProjectId(createdProject.projectId)
      setProjectError('')
    } finally {
      setIsCreating(false)
    }
  }

  const handleAddDocument = async () => {
    if (selectedProjectId === null || isAddingDocument) return

    setIsAddingDocument(true)
    try {
      const createdDocument = await window.desktop.addDocumentFromDialog(selectedProjectId)
      if (!createdDocument) return

      setDocuments((current) => [createdDocument, ...current])
      setDocumentError('')
      await window.desktop.openDocumentReader(createdDocument.documentId)
    } catch {
      setDocumentError('Could not add document. Please try again.')
    } finally {
      setIsAddingDocument(false)
    }
  }

  const handleOpenDocument = async (documentId: number) => {
    try {
      await window.desktop.openDocumentReader(documentId)
      setDocumentError('')
    } catch {
      setDocumentError('Could not open document reader.')
    }
  }

  const startRenamingProject = (project: ProjectRecord) => {
    setEditingProjectId(project.projectId)
    setEditingName(project.projectName)
  }

  const cancelRenaming = () => {
    setEditingProjectId(null)
    setEditingName('')
  }

  const commitRename = async (projectId: number) => {
    if (isSavingRename) return

    if (typeof window.desktop.renameProject !== 'function') {
      setProjectError(
        'Project rename API is unavailable in this session. Stop and rerun desktop app.',
      )
      cancelRenaming()
      return
    }

    const nextName = editingName.trim()
    const currentProject = projects.find((project) => project.projectId === projectId)
    if (!currentProject) {
      cancelRenaming()
      return
    }

    if (!nextName || nextName === currentProject.projectName) {
      cancelRenaming()
      return
    }

    setIsSavingRename(true)
    try {
      const updatedProject = await window.desktop.renameProject(projectId, nextName)
      setProjects((current) => [
        updatedProject,
        ...current.filter((project) => project.projectId !== updatedProject.projectId),
      ])
      setSelectedProjectId(updatedProject.projectId)
      setProjectError('')
      cancelRenaming()
    } catch {
      setProjectError('Could not save project name. Please try again.')
    } finally {
      setIsSavingRename(false)
    }
  }

  return (
    <main className="app">
      {isSidebarOpen ? (
        <aside className="sidebar" aria-label="Project sidebar">
          <div className="sidebar-header">
            <h1>Projects</h1>
            <button
              type="button"
              className="close-sidebar-btn"
              onClick={() => setIsSidebarOpen(false)}
              aria-label="Close project sidebar"
            >
              x
            </button>
          </div>
          <input
            type="search"
            className="project-search"
            placeholder="Search project"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="Search projects"
          />
          {projectError ? <p className="project-error">{projectError}</p> : null}

          <div className="project-list-wrap">
            <ul className="project-list">
              {filteredProjects.map((project) => (
                <li key={project.projectId}>
                  {editingProjectId === project.projectId ? (
                    <input
                      type="text"
                      className="project-name-input"
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      onBlur={() => void commitRename(project.projectId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void commitRename(project.projectId)
                        }

                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelRenaming()
                        }
                      }}
                      autoFocus
                      maxLength={120}
                    />
                  ) : (
                    <button
                      type="button"
                      className={
                        selectedProjectId === project.projectId
                          ? 'project-item project-item-active'
                          : 'project-item'
                      }
                      onClick={() => {
                        setSelectedProjectId(project.projectId)
                        setProjectError('')
                        setDocumentError('')
                      }}
                      onDoubleClick={() => startRenamingProject(project)}
                    >
                      {project.projectName}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="create-project-box">
            <p>Create New Project</p>
            <button
              type="button"
              className="create-project-btn"
              onClick={() => void handleCreateProject()}
              disabled={isCreating}
              aria-label="Create new project"
            >
              +
            </button>
          </div>
        </aside>
      ) : (
        <button
          type="button"
          className="open-sidebar-fab"
          onClick={() => setIsSidebarOpen(true)}
          aria-label="Open project sidebar"
        >
          P
        </button>
      )}

      <section className="workspace">
        {selectedProject ? (
          <section className="project-dashboard">
            <header className="dashboard-top">
              <div className="dashboard-top-left">
                <div className="tag project-tag">{selectedProject.projectName}</div>
              </div>
              <div className="documents-head">
                <div className="tag documents-tag">Documents</div>
                <button
                  type="button"
                  className="documents-add-btn"
                  aria-label="Add document"
                  onClick={() => void handleAddDocument()}
                  disabled={isAddingDocument}
                >
                  +
                </button>
              </div>
              <div aria-hidden="true" />
            </header>

            <section className="dashboard-grid">
              <div className="left-column">
                <article className="panel details-panel">
                  <button type="button" className="ghost-chip chip-description">
                    <svg className="chip-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h12M4 18h8"/></svg>
                    Description
                  </button>
                  <button type="button" className="ghost-chip chip-instructions">
                    <svg className="chip-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>
                    Custom Instructions
                  </button>
                  <button type="button" className="ghost-chip chip-notes">
                    <svg className="chip-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Misc Notes
                  </button>
                </article>

                <article className="panel agents-panel">
                  <h2>
                    <svg className="panel-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>
                    Agents
                  </h2>
                </article>
              </div>

              <article className="panel documents-panel">
                <div className="documents-panel-head">
                  <h2>
                    <svg className="panel-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
                    The list of documents
                  </h2>
                </div>
                {documentError ? <p className="project-error">{documentError}</p> : null}
                {documents.length > 0 ? (
                  <ul className="document-list">
                    {documents.map((document) => (
                      <li key={document.documentId}>
                        <button
                          type="button"
                          className="document-item"
                          onClick={() => void handleOpenDocument(document.documentId)}
                        >
                          <svg className="doc-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></svg>
                          {document.documentName}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="documents-empty">No documents yet. Click + to add a PDF.</p>
                )}
              </article>

              <div className="right-column">
                <article className="panel memory-panel">
                  <h2>
                    <svg className="panel-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                    Memory
                  </h2>
                </article>
                <article className="panel files-panel">
                  <h2>
                    <svg className="panel-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    Other Files
                  </h2>
                </article>
              </div>
            </section>
          </section>
        ) : (
          <section className="empty-workspace">
            <h2>No project selected</h2>
            <p>Create a project from the sidebar to open its dashboard.</p>
          </section>
        )}
      </section>
    </main>
  )
}

export default App
