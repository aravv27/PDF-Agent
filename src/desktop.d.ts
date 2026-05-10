interface ProjectRecord {
  projectId: number
  projectName: string
  createdAt: string
  updatedAt: string
}

interface DocumentRecord {
  documentId: number
  projectId: number
  documentName: string
  filePath: string
  createdAt: string
  updatedAt: string
}

interface DesktopApi {
  platform: string
  listProjects: () => Promise<ProjectRecord[]>
  createProject: (projectName: string) => Promise<ProjectRecord>
  renameProject: (projectId: number, projectName: string) => Promise<ProjectRecord>
  listDocuments: (projectId: number) => Promise<DocumentRecord[]>
  addDocumentFromDialog: (projectId: number) => Promise<DocumentRecord | null>
  getDocumentById: (documentId: number) => Promise<DocumentRecord | null>
  readDocumentBytes: (documentId: number) => Promise<Uint8Array>
  openDocumentReader: (documentId: number) => Promise<boolean>
}

declare global {
  interface Window {
    desktop: DesktopApi
  }
}

export {}
