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
                  <button type="button" className="ghost-chip">
                    Description
                  </button>
                  <button type="button" className="ghost-chip">
                    Custom Instructions
                  </button>
                  <button type="button" className="ghost-chip">
                    Misc Notes
                  </button>
                </article>

                <article className="panel agents-panel">
                  <h2>Agents</h2>
                </article>
              </div>

              <article className="panel documents-panel">
                <div className="documents-panel-head">
                  <h2>The list of documents</h2>
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
                  <h2>Memory</h2>
                </article>
                <article className="panel files-panel">
                  <h2>Other Files</h2>
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
