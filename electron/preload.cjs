const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (projectName) => ipcRenderer.invoke('projects:create', projectName),
  renameProject: (projectId, projectName) =>
    ipcRenderer.invoke('projects:rename', projectId, projectName),
})
