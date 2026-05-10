const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (projectName) => ipcRenderer.invoke('projects:create', projectName),
  renameProject: (projectId, projectName) =>
    ipcRenderer.invoke('projects:rename', projectId, projectName),
  listDocuments: (projectId) => ipcRenderer.invoke('documents:list', projectId),
  addDocumentFromDialog: (projectId) =>
    ipcRenderer.invoke('documents:add-from-dialog', projectId),
  getDocumentById: (documentId) => ipcRenderer.invoke('documents:get-by-id', documentId),
  readDocumentBytes: (documentId) => ipcRenderer.invoke('documents:read-bytes', documentId),
  openDocumentReader: (documentId) => ipcRenderer.invoke('documents:open-reader', documentId),
})
