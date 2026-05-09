interface ProjectRecord {
  projectId: number
  projectName: string
  createdAt: string
  updatedAt: string
}

interface DesktopApi {
  platform: string
  listProjects: () => Promise<ProjectRecord[]>
  createProject: (projectName: string) => Promise<ProjectRecord>
  renameProject: (projectId: number, projectName: string) => Promise<ProjectRecord>
}

declare global {
  interface Window {
    desktop: DesktopApi
  }
}

export {}
