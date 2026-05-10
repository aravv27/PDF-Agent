import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ReaderApp from './ReaderApp'

function resolveRootComponent() {
  const match = window.location.hash.match(/^#reader\/(\d+)$/)
  if (match) {
    const documentId = Number(match[1])
    if (Number.isInteger(documentId) && documentId > 0) {
      return <ReaderApp documentId={documentId} />
    }
  }

  return <App />
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    {resolveRootComponent()}
  </StrictMode>,
)
