import { useEffect, useMemo, useRef, useState } from 'react'
import { GlobalWorkerOptions, TextLayer, getDocument } from 'pdfjs-dist'
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextContent,
} from 'pdfjs-dist/types/src/display/api'
import type { PageViewport } from 'pdfjs-dist/types/src/display/display_utils'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import './reader.css'

GlobalWorkerOptions.workerSrc = workerSrc

type ReaderAppProps = {
  documentId: number
}

type ReaderDocumentRecord = {
  documentId: number
  projectId: number
  documentName: string
  filePath: string
  createdAt: string
  updatedAt: string
}

type OutlineNode = {
  title: string
  dest: string | unknown[] | null
  url?: string | null
  items?: OutlineNode[]
}

type FlatOutlineItem = {
  key: string
  title: string
  depth: number
  dest: string | unknown[] | null
  url?: string | null
}

type PageMetrics = {
  width: number
  height: number
}

type PdfTextItem = {
  str?: string
  transform?: number[]
  width?: number
  height?: number
  fontName?: string
}

type ReaderPageProps = {
  pdfDocument: PDFDocumentProxy
  pageNumber: number
  scale: number
  rotation: number
  estimatedHeight: number
  scrollRoot: HTMLElement | null
  onVisibleChange: (pageNumber: number, isVisible: boolean) => void
  onNavigateDest: (dest: string | unknown[] | null) => void
}

function normalizeBytes(rawBytes: Uint8Array | ArrayBuffer): Uint8Array {
  if (rawBytes instanceof Uint8Array) {
    return rawBytes
  }
  return new Uint8Array(rawBytes)
}

function normalizeRotation(value: number): number {
  const normalized = ((value % 360) + 360) % 360
  return (Math.round(normalized / 90) * 90) % 360
}

function getScaleForMode(mode: 'custom' | 'actual', customZoom: number): number {
  if (mode === 'actual') {
    return 1
  }
  return customZoom
}

function flattenOutline(items: OutlineNode[] | null | undefined): FlatOutlineItem[] {
  if (!items || items.length === 0) return []

  const flat: FlatOutlineItem[] = []

  const walk = (nodes: OutlineNode[], depth: number) => {
    for (const node of nodes) {
      flat.push({
        key: `${depth}-${flat.length}-${node.title}`,
        title: node.title || 'Untitled',
        depth,
        dest: node.dest ?? null,
        url: node.url ?? null,
      })
      if (node.items && node.items.length > 0) {
        walk(node.items, depth + 1)
      }
    }
  }

  walk(items, 0)
  return flat
}

function ReaderPage({
  pdfDocument,
  pageNumber,
  scale,
  rotation,
  estimatedHeight,
  scrollRoot,
  onVisibleChange,
  onNavigateDest,
}: ReaderPageProps) {
  const pageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const annotationLayerRef = useRef<HTMLDivElement | null>(null)
  const [renderedHeight, setRenderedHeight] = useState<number | null>(null)
  const [shouldRender, setShouldRender] = useState(pageNumber <= 2)
  const [pageError, setPageError] = useState('')

  useEffect(() => {
    if (!pageRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        onVisibleChange(pageNumber, entry.isIntersecting)
        if (entry.isIntersecting || entry.intersectionRatio > 0) {
          setShouldRender(true)
        }
      },
      {
        root: scrollRoot,
        rootMargin: '1200px',
        threshold: [0, 0.45],
      },
    )

    observer.observe(pageRef.current)
    return () => observer.disconnect()
  }, [onVisibleChange, pageNumber, scrollRoot])

  useEffect(() => {
    if (!shouldRender || !canvasRef.current || !textLayerRef.current || !annotationLayerRef.current) {
      return
    }

    let isCancelled = false
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null

    const renderPage = async () => {
      try {
        setPageError('')
        const page = await pdfDocument.getPage(pageNumber)
        if (isCancelled || !canvasRef.current || !textLayerRef.current || !annotationLayerRef.current) {
          return
        }

        const viewport = page.getViewport({ scale, rotation })
        const canvas = canvasRef.current
        const context = canvas.getContext('2d')
        if (!context) return

        const outputScale = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`

        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: [outputScale, 0, 0, outputScale, 0, 0],
        })
        await renderTask.promise
        if (isCancelled) return

        setRenderedHeight(viewport.height)

        const textLayerDiv = textLayerRef.current
        textLayerDiv.innerHTML = ''
        textLayerDiv.style.width = `${Math.floor(viewport.width)}px`
        textLayerDiv.style.height = `${Math.floor(viewport.height)}px`
        textLayerDiv.style.setProperty('--scale-factor', String(viewport.scale))

        const textContent = (await page.getTextContent()) as TextContent
        const textLayer = new TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        })
        await textLayer.render()
        if (isCancelled) return

        await renderLinkAnnotations({
          page,
          viewport,
          container: annotationLayerRef.current,
          onNavigateDest,
        })
      } catch {
        if (!isCancelled) {
          setPageError(`Failed to render page ${pageNumber}`)
        }
      }
    }

    void renderPage()

    return () => {
      isCancelled = true
      if (renderTask) {
        renderTask.cancel()
      }
    }
  }, [
    onNavigateDest,
    pageNumber,
    pdfDocument,
    rotation,
    scale,
    shouldRender,
  ])

  const frameHeight = renderedHeight ?? estimatedHeight

  return (
    <div ref={pageRef} className="reader-page-frame" style={{ minHeight: frameHeight }}>
      {shouldRender ? (
        <div className="reader-page-stack">
          <canvas ref={canvasRef} className="reader-canvas" />
          <div ref={textLayerRef} className="textLayer reader-text-layer" />
          <div ref={annotationLayerRef} className="reader-annotation-layer" />
          {pageError ? <p className="reader-error">{pageError}</p> : null}
        </div>
      ) : (
        <div className="reader-page-placeholder" style={{ height: frameHeight }}>
          <span>Page {pageNumber}</span>
        </div>
      )}
    </div>
  )
}

async function renderLinkAnnotations({
  page,
  viewport,
  container,
  onNavigateDest,
}: {
  page: PDFPageProxy
  viewport: PageViewport
  container: HTMLDivElement | null
  onNavigateDest: (dest: string | unknown[] | null) => void
}) {
  if (!container) return

  container.innerHTML = ''
  container.style.width = `${Math.floor(viewport.width)}px`
  container.style.height = `${Math.floor(viewport.height)}px`

  const annotations = await page.getAnnotations({ intent: 'display' })

  for (const annotation of annotations) {
    if (!Array.isArray(annotation.rect) || annotation.rect.length < 4) continue

    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annotation.rect)
    const left = Math.min(x1, x2)
    const top = Math.min(y1, y2)
    const width = Math.abs(x2 - x1)
    const height = Math.abs(y2 - y1)

    if (width < 1 || height < 1) continue

    const hasLinkTarget = Boolean(annotation.url || annotation.unsafeUrl || annotation.dest)
    if (!hasLinkTarget && annotation.subtype !== 'Text') continue

    const layerNode = document.createElement(hasLinkTarget ? 'a' : 'div')
    layerNode.className = hasLinkTarget
      ? 'reader-annotation-link'
      : 'reader-annotation-note'
    layerNode.style.left = `${left}px`
    layerNode.style.top = `${top}px`
    layerNode.style.width = `${width}px`
    layerNode.style.height = `${height}px`

    if (annotation.contents) {
      layerNode.title = String(annotation.contents)
    }

    if (hasLinkTarget && layerNode instanceof HTMLAnchorElement) {
      const url = (annotation.url || annotation.unsafeUrl) as string | undefined
      if (url) {
        layerNode.href = url
        layerNode.target = '_blank'
        layerNode.rel = 'noreferrer'
      } else {
        layerNode.href = '#'
        layerNode.addEventListener('click', (event) => {
          event.preventDefault()
          onNavigateDest((annotation.dest as string | unknown[] | null) ?? null)
        })
      }
    }

    container.appendChild(layerNode)
  }
}

async function renderThumbnail({
  page,
  canvas,
}: {
  page: PDFPageProxy
  canvas: HTMLCanvasElement
}) {
  const viewport = page.getViewport({ scale: 0.2 })
  const outputScale = window.devicePixelRatio || 1
  const context = canvas.getContext('2d')
  if (!context) return

  canvas.width = Math.floor(viewport.width * outputScale)
  canvas.height = Math.floor(viewport.height * outputScale)
  canvas.style.width = `${Math.floor(viewport.width)}px`
  canvas.style.height = `${Math.floor(viewport.height)}px`

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: [outputScale, 0, 0, outputScale, 0, 0],
  }).promise
}

function ReaderApp({ documentId }: ReaderAppProps) {
  const [documentName, setDocumentName] = useState('PDF Reader')
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [rotation, setRotation] = useState(0)
  const [zoomMode, setZoomMode] = useState<'custom' | 'actual'>('custom')
  const [customZoom, setCustomZoom] = useState(1.2)
  const visiblePagesRef = useRef<Record<number, boolean>>({})
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [isLoading, setIsLoading] = useState(true)
  const [readerError, setReaderError] = useState('')
  const [outlineItems, setOutlineItems] = useState<FlatOutlineItem[]>([])
  const [activeTab, setActiveTab] = useState<'thumbs' | 'outline'>('thumbs')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [naturalPageSize, setNaturalPageSize] = useState<PageMetrics | null>(null)
  const [extractStatus, setExtractStatus] = useState('')
  const scrollWrapRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const thumbnailCanvasRef = useRef<Record<number, HTMLCanvasElement | null>>({})
  const destinationPageCache = useRef<Record<string, number>>({})

  useEffect(() => {
    let isAlive = true

    const loadDocument = async () => {
      try {
        setReaderError('')
        setIsLoading(true)

        const documentRow = (await window.desktop.getDocumentById(
          documentId,
        )) as ReaderDocumentRecord | null
        if (!documentRow) throw new Error('Document not found.')

        if (isAlive) {
          setDocumentName(documentRow.documentName)
        }

        const rawBytes = await window.desktop.readDocumentBytes(documentId)
        const bytes = normalizeBytes(rawBytes)
        const loadingTask = getDocument({ data: bytes })
        const loadedPdf = await loadingTask.promise

        if (!isAlive) {
          await loadedPdf.destroy()
          return
        }

        setPdfDocument(loadedPdf)
        setNumPages(loadedPdf.numPages)
        setPageInput('1')

        const firstPage = await loadedPdf.getPage(1)
        const naturalViewport = firstPage.getViewport({ scale: 1, rotation: 0 })
        setNaturalPageSize({
          width: naturalViewport.width,
          height: naturalViewport.height,
        })

        const outline = (await loadedPdf.getOutline()) as OutlineNode[] | null
        if (isAlive) {
          setOutlineItems(flattenOutline(outline))
        }
      } catch {
        if (isAlive) {
          setReaderError('Unable to load this PDF document.')
        }
      } finally {
        if (isAlive) setIsLoading(false)
      }
    }

    void loadDocument()
    return () => {
      isAlive = false
    }
  }, [documentId])

  const defaultPageMetrics = useMemo(
    () => naturalPageSize ?? { width: 820, height: 1120 },
    [naturalPageSize],
  )

  const orientedBasePageSize = useMemo(() => {
    if (normalizeRotation(rotation) % 180 === 0) {
      return defaultPageMetrics
    }
    return {
      width: defaultPageMetrics.height,
      height: defaultPageMetrics.width,
    }
  }, [defaultPageMetrics, rotation])

  const effectiveScale = useMemo(
    () => getScaleForMode(zoomMode, customZoom),
    [customZoom, zoomMode],
  )

  const estimatedPageHeight = useMemo(() => {
    return orientedBasePageSize.height * effectiveScale + 24
  }, [effectiveScale, orientedBasePageSize.height])

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  const scrollToPage = (pageNumber: number) => {
    const target = pageRefs.current[pageNumber]
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const handleJumpToInputPage = () => {
    const pageNumber = Number(pageInput)
    if (!Number.isInteger(pageNumber)) return
    const target = Math.max(1, Math.min(numPages, pageNumber))
    scrollToPage(target)
  }

  const resolveDestinationToPage = async (dest: string | unknown[] | null): Promise<number | null> => {
    if (!pdfDocument || !dest) return null

    const cacheKey = typeof dest === 'string' ? `n:${dest}` : `a:${JSON.stringify(dest)}`
    if (destinationPageCache.current[cacheKey]) {
      return destinationPageCache.current[cacheKey]
    }

    const resolvedDest =
      typeof dest === 'string' ? await pdfDocument.getDestination(dest) : dest
    if (!resolvedDest || !Array.isArray(resolvedDest) || resolvedDest.length === 0) {
      return null
    }

    const ref = resolvedDest[0] as { num?: number; gen?: number } | null
    if (!ref || typeof ref !== 'object' || typeof ref.num !== 'number') {
      return null
    }

    const pageIndex = await pdfDocument.getPageIndex(ref as never)
    const pageNumber = pageIndex + 1
    destinationPageCache.current[cacheKey] = pageNumber
    return pageNumber
  }

  const handleNavigateDest = (dest: string | unknown[] | null) => {
    void (async () => {
      const pageNumber = await resolveDestinationToPage(dest)
      if (!pageNumber) return
      scrollToPage(pageNumber)
    })()
  }

  const handleExportTextContext = () => {
    if (!pdfDocument) return

    void (async () => {
      try {
        setExtractStatus('Extracting text...')
        const pages: Array<{
          pageNumber: number
          text: string
          chunks: Array<{
            text: string
            width: number
            height: number
            transform: number[] | null
            fontName: string | null
          }>
        }> = []

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const page = await pdfDocument.getPage(pageNumber)
          const textContent = (await page.getTextContent()) as TextContent
          const items = textContent.items as PdfTextItem[]

          const chunks = items.map((item) => ({
            text: item.str ?? '',
            width: Number(item.width ?? 0),
            height: Number(item.height ?? 0),
            transform: Array.isArray(item.transform) ? item.transform : null,
            fontName: item.fontName ?? null,
          }))

          pages.push({
            pageNumber,
            text: chunks.map((chunk) => chunk.text).join(' '),
            chunks,
          })
        }

        const payload = {
          documentId,
          documentName,
          extractedAt: new Date().toISOString(),
          pages,
        }

        const blob = new Blob([JSON.stringify(payload, null, 2)], {
          type: 'application/json',
        })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${documentName.replace(/[^a-z0-9-_ ]/gi, '_')}_context.json`
        anchor.click()
        URL.revokeObjectURL(url)
        setExtractStatus('Context exported.')
      } catch {
        setExtractStatus('Failed to extract text.')
      }
    })()
  }

  useEffect(() => {
    if (!pdfDocument) return

    let isCancelled = false

    const loadThumbnails = async () => {
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        if (isCancelled) return
        const canvas = thumbnailCanvasRef.current[pageNumber]
        if (!canvas) continue

        try {
          const page = await pdfDocument.getPage(pageNumber)
          await renderThumbnail({ page, canvas })
        } catch {
          // Ignore single thumbnail failures.
        }
      }
    }

    void loadThumbnails()
    return () => {
      isCancelled = true
    }
  }, [pdfDocument])

  return (
    <main className="reader-shell reader-shell-advanced">
      <header className="reader-toolbar">
        <div className="toolbar-left">
          <button type="button" className="reader-icon-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)} aria-label="Toggle sidebar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
          </button>
          <h1 className="reader-title">{documentName}</h1>
        </div>

        <div className="reader-controls">
          <div className="control-group search-group" style={{ display: 'none' }}>
            {/* Search hidden entirely */}
          </div>

          <div className="control-group nav-group">
            <span className="reader-status">Page</span>
            <input
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleJumpToInputPage()
              }}
              className="reader-input page"
              aria-label="Jump to page"
            />
            <span className="reader-status">/ {numPages}</span>
            <button type="button" className="reader-btn" onClick={handleJumpToInputPage}>Go</button>
          </div>

          <div className="control-group zoom-group">
            <button type="button" className="reader-icon-btn" onClick={() => { setZoomMode('custom'); setCustomZoom((current) => Math.max(0.3, Number((current - 0.1).toFixed(2)))) }} aria-label="Zoom out">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <span className="reader-status">{Math.round(effectiveScale * 100)}%</span>
            <button type="button" className="reader-icon-btn" onClick={() => { setZoomMode('custom'); setCustomZoom((current) => Math.min(4, Number((current + 0.1).toFixed(2)))) }} aria-label="Zoom in">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button type="button" className="reader-btn" onClick={() => setZoomMode('actual')}>Actual</button>
          </div>

          <div className="control-group action-group">
            <button type="button" className="reader-icon-btn" onClick={() => setRotation((current) => normalizeRotation(current + 90))} title="Rotate">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-5.4 5.4"/></svg>
            </button>
            <button type="button" className="reader-btn primary" onClick={handleExportTextContext}>
              Export Context
            </button>
          </div>
        </div>
      </header>

      <section className="reader-layout">
        {isSidebarOpen && (
          <aside className="reader-sidebar">
            <div className="reader-segmented-control">
              <button
                type="button"
                className={`segmented-tab ${activeTab === 'thumbs' ? 'active' : ''}`}
                onClick={() => setActiveTab('thumbs')}
              >
                Thumbnails
              </button>
              <button
                type="button"
                className={`segmented-tab ${activeTab === 'outline' ? 'active' : ''}`}
                onClick={() => setActiveTab('outline')}
              >
                Outline
              </button>
            </div>

            {activeTab === 'thumbs' ? (
              <div className="reader-section">
                <ul className="thumb-list">
                  {Array.from({ length: numPages }, (_, index) => {
                    const page = index + 1
                    return (
                      <li key={`thumb-${page}`}>
                        <button
                          type="button"
                          className={`thumb-item ${currentPage === page ? 'active' : ''}`}
                          onClick={() => scrollToPage(page)}
                          title={`Go to page ${page}`}
                        >
                          <canvas
                            ref={(node) => {
                              thumbnailCanvasRef.current[page] = node
                            }}
                          />
                          <span>{page}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}

            {activeTab === 'outline' ? (
              <div className="reader-section">
                {outlineItems.length > 0 ? (
                  <ul className="outline-list">
                    {outlineItems.map((item) => (
                      <li key={item.key}>
                        <button
                          type="button"
                          className="outline-item"
                          style={{ paddingLeft: `${10 + item.depth * 14}px` }}
                          onClick={() => {
                            if (item.url) {
                              window.open(item.url, '_blank')
                              return
                            }
                            handleNavigateDest(item.dest)
                          }}
                        >
                          {item.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="reader-empty-note">No outline in this PDF.</p>
                )}
              </div>
            ) : null}
          </aside>
        )}

        <div className="reader-main">
          <div className="reader-meta-row">
            <span className="reader-status">
              Page {currentPage} / {numPages}
            </span>
            {extractStatus && <span className="reader-status">{extractStatus}</span>}
          </div>
          <section ref={scrollWrapRef} className="reader-canvas-wrap advanced">
            {isLoading ? <p className="reader-message">Loading PDF...</p> : null}
            {readerError ? <p className="reader-error">{readerError}</p> : null}
            {pdfDocument && !readerError ? (
              <div className="reader-pages-stack">
                {Array.from({ length: numPages }, (_, index) => {
                  const page = index + 1
                  return (
                    <div
                      key={`page-wrap-${page}`}
                      ref={(node) => {
                        pageRefs.current[page] = node
                      }}
                    >
                      <ReaderPage
                        pdfDocument={pdfDocument}
                        pageNumber={page}
                        scale={effectiveScale}
                        rotation={rotation}
                        estimatedHeight={estimatedPageHeight}
                        scrollRoot={scrollWrapRef.current}
                        onVisibleChange={(pageNumber, isVisible) => {
                          const currentVisible = { ...visiblePagesRef.current }
                          currentVisible[pageNumber] = isVisible
                          visiblePagesRef.current = currentVisible

                          const visible = Object.entries(currentVisible)
                            .filter(([, value]) => value)
                            .map(([page]) => Number(page))
                            .sort((a, b) => a - b)
                          
                          const newCurrentPage = visible.length > 0 ? visible[0] : 1
                          setCurrentPage((prev) => {
                            if (prev !== newCurrentPage) return newCurrentPage
                            return prev
                          })
                        }}
                        onNavigateDest={handleNavigateDest}
                      />
                    </div>
                  )
                })}
              </div>
            ) : null}
          </section>
        </div>
      </section>
    </main>
  )
}

export default ReaderApp
