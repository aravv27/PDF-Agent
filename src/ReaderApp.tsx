import { useEffect, useMemo, useRef, useState } from 'react'
import { GlobalWorkerOptions, TextLayer, getDocument } from 'pdfjs-dist'
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextContent,
} from 'pdfjs-dist/types/src/display/api'
import type { PageViewport } from 'pdfjs-dist/types/src/display/display_utils'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'
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

type TextCacheEntry = {
  strings: string[]
}

type ReaderPageProps = {
  pdfDocument: PDFDocumentProxy
  pageNumber: number
  scale: number
  rotation: number
  searchQuery: string
  estimatedHeight: number
  scrollRoot: HTMLElement | null
  onMatchCount: (pageNumber: number, count: number) => void
  onTextCached: (pageNumber: number, strings: string[]) => void
  onVisibleChange: (pageNumber: number, isVisible: boolean) => void
  onNavigateDest: (dest: string | unknown[] | null) => void
}

type PdfTextItem = {
  str?: string
  transform?: number[]
  width?: number
  height?: number
  fontName?: string
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

function getScaleForMode(
  mode: 'custom' | 'actual' | 'fit-width' | 'fit-page',
  customZoom: number,
  containerSize: { width: number; height: number },
  basePageSize: PageMetrics | null,
): number {
  if (!basePageSize) {
    return customZoom
  }

  if (mode === 'actual') {
    return 1
  }

  if (mode === 'fit-width') {
    return Math.max(0.3, (containerSize.width - 48) / basePageSize.width)
  }

  if (mode === 'fit-page') {
    const scaleByWidth = (containerSize.width - 48) / basePageSize.width
    const scaleByHeight = (containerSize.height - 48) / basePageSize.height
    return Math.max(0.3, Math.min(scaleByWidth, scaleByHeight))
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

function applySearchHighlights(
  strings: string[],
  textDivs: HTMLElement[],
  query: string,
): number {
  const normalizedQuery = query.trim().toLowerCase()

  for (const div of textDivs) {
    div.classList.remove('pdf-search-hit')
  }

  if (!normalizedQuery) {
    return 0
  }

  let count = 0
  for (let index = 0; index < strings.length && index < textDivs.length; index += 1) {
    const value = strings[index]?.toLowerCase() ?? ''
    if (value.includes(normalizedQuery)) {
      textDivs[index].classList.add('pdf-search-hit')
      count += 1
    }
  }

  return count
}

function ReaderPage({
  pdfDocument,
  pageNumber,
  scale,
  rotation,
  searchQuery,
  estimatedHeight,
  scrollRoot,
  onMatchCount,
  onTextCached,
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
  const textLayerInstanceRef = useRef<TextLayer | null>(null)
  const textStringsRef = useRef<string[]>([])

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
    const textLayer = textLayerInstanceRef.current
    if (!textLayer) {
      onMatchCount(pageNumber, 0)
      return
    }

    const count = applySearchHighlights(textStringsRef.current, textLayer.textDivs, searchQuery)
    onMatchCount(pageNumber, count)
  }, [onMatchCount, pageNumber, searchQuery, shouldRender])

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

        const textContent = (await page.getTextContent()) as TextContent
        const textLayer = new TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        })
        await textLayer.render()
        if (isCancelled) return

        textLayerInstanceRef.current = textLayer
        textStringsRef.current = textLayer.textContentItemsStr
        onTextCached(pageNumber, textLayer.textContentItemsStr)

        const matchCount = applySearchHighlights(
          textLayer.textContentItemsStr,
          textLayer.textDivs,
          searchQuery,
        )
        onMatchCount(pageNumber, matchCount)

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
      textLayerInstanceRef.current?.cancel()
    }
  }, [
    onMatchCount,
    onNavigateDest,
    onTextCached,
    pageNumber,
    pdfDocument,
    rotation,
    scale,
    searchQuery,
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
  const [zoomMode, setZoomMode] = useState<'custom' | 'actual' | 'fit-width' | 'fit-page'>(
    'fit-width',
  )
  const [customZoom, setCustomZoom] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchCountsByPage, setMatchCountsByPage] = useState<Record<number, number>>({})
  const [visiblePages, setVisiblePages] = useState<Record<number, boolean>>({})
  const [pageInput, setPageInput] = useState('1')
  const [isLoading, setIsLoading] = useState(true)
  const [readerError, setReaderError] = useState('')
  const [outlineItems, setOutlineItems] = useState<FlatOutlineItem[]>([])
  const [showOutline, setShowOutline] = useState(true)
  const [showThumbs, setShowThumbs] = useState(true)
  const [containerSize, setContainerSize] = useState({ width: 1200, height: 900 })
  const [naturalPageSize, setNaturalPageSize] = useState<PageMetrics | null>(null)
  const [extractStatus, setExtractStatus] = useState('')
  const [textCache, setTextCache] = useState<Record<number, TextCacheEntry>>({})
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

  useEffect(() => {
    if (!scrollWrapRef.current) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })

    observer.observe(scrollWrapRef.current)
    return () => observer.disconnect()
  }, [])

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
    () => getScaleForMode(zoomMode, customZoom, containerSize, orientedBasePageSize),
    [containerSize, customZoom, orientedBasePageSize, zoomMode],
  )

  const estimatedPageHeight = useMemo(() => {
    return orientedBasePageSize.height * effectiveScale + 24
  }, [effectiveScale, orientedBasePageSize.height])

  const totalMatches = useMemo(
    () => Object.values(matchCountsByPage).reduce((sum, count) => sum + count, 0),
    [matchCountsByPage],
  )

  const currentPage = useMemo(() => {
    const visible = Object.entries(visiblePages)
      .filter(([, value]) => value)
      .map(([page]) => Number(page))
      .sort((a, b) => a - b)
    if (visible.length > 0) return visible[0]
    return 1
  }, [visiblePages])

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  const matchedPages = useMemo(
    () =>
      Object.entries(matchCountsByPage)
        .filter(([, count]) => count > 0)
        .map(([page]) => Number(page))
        .sort((a, b) => a - b),
    [matchCountsByPage],
  )

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

  const handleStepSearch = (direction: 1 | -1) => {
    if (matchedPages.length === 0) return

    if (direction === 1) {
      const next = matchedPages.find((page) => page > currentPage) ?? matchedPages[0]
      scrollToPage(next)
      return
    }

    const reverse = [...matchedPages].reverse()
    const prev = reverse.find((page) => page < currentPage) ?? reverse[0]
    scrollToPage(prev)
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

  useEffect(() => {
    if (!pdfDocument) return
    if (!searchQuery.trim()) return

    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const normalizedQuery = searchQuery.trim().toLowerCase()

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          if (cancelled) return

          if (!textCache[pageNumber]) {
            try {
              const page = await pdfDocument.getPage(pageNumber)
              const textContent = (await page.getTextContent()) as TextContent
              const strings = (textContent.items as PdfTextItem[]).map((item) => item.str ?? '')
              if (!cancelled) {
                setTextCache((current) => ({
                  ...current,
                  [pageNumber]: { strings },
                }))
              }
            } catch {
              // Ignore indexing failure for this page.
            }
          }
        }

        if (!cancelled) {
          setMatchCountsByPage((current) => {
            const next: Record<number, number> = { ...current }
            for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
              const entry = textCache[pageNumber]
              if (!entry) continue
              const count = entry.strings.reduce((sum, text) => {
                if (!normalizedQuery) return 0
                return sum + (text.toLowerCase().includes(normalizedQuery) ? 1 : 0)
              }, 0)
              next[pageNumber] = count
            }
            return next
          })
        }
      })()
    }, 260)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [pdfDocument, searchQuery, textCache])

  return (
    <main className="reader-shell reader-shell-advanced">
      <header className="reader-toolbar">
        <h1 className="reader-title">{documentName}</h1>
        <div className="reader-controls">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search text"
            className="reader-input search"
          />
          <button type="button" className="reader-btn" onClick={() => handleStepSearch(-1)}>
            Prev
          </button>
          <button type="button" className="reader-btn" onClick={() => handleStepSearch(1)}>
            Next
          </button>
          <span className="reader-status">{totalMatches} matches</span>
          <input
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleJumpToInputPage()
            }}
            className="reader-input page"
            aria-label="Jump to page"
          />
          <button type="button" className="reader-btn" onClick={handleJumpToInputPage}>
            Go
          </button>
          <button
            type="button"
            className="reader-btn"
            onClick={() => {
              setZoomMode('custom')
              setCustomZoom((current) => Math.max(0.3, Number((current - 0.1).toFixed(2))))
            }}
          >
            -
          </button>
          <span className="reader-status">{Math.round(effectiveScale * 100)}%</span>
          <button
            type="button"
            className="reader-btn"
            onClick={() => {
              setZoomMode('custom')
              setCustomZoom((current) => Math.min(4, Number((current + 0.1).toFixed(2))))
            }}
          >
            +
          </button>
          <button type="button" className="reader-btn" onClick={() => setZoomMode('actual')}>
            Actual
          </button>
          <button type="button" className="reader-btn" onClick={() => setZoomMode('fit-width')}>
            Fit Width
          </button>
          <button type="button" className="reader-btn" onClick={() => setZoomMode('fit-page')}>
            Fit Page
          </button>
          <button
            type="button"
            className="reader-btn"
            onClick={() => setRotation((current) => normalizeRotation(current + 90))}
          >
            Rotate
          </button>
          <button type="button" className="reader-btn" onClick={handleExportTextContext}>
            Export Context
          </button>
        </div>
      </header>

      <section className="reader-layout">
        <aside className="reader-sidebar">
          <div className="reader-side-toggle-row">
            <button
              type="button"
              className="reader-chip-btn"
              onClick={() => setShowThumbs((current) => !current)}
            >
              {showThumbs ? 'Hide Thumbs' : 'Show Thumbs'}
            </button>
            <button
              type="button"
              className="reader-chip-btn"
              onClick={() => setShowOutline((current) => !current)}
            >
              {showOutline ? 'Hide Outline' : 'Show Outline'}
            </button>
          </div>

          {showThumbs ? (
            <div className="reader-section">
              <h2>Thumbnails</h2>
              <ul className="thumb-list">
                {Array.from({ length: numPages }, (_, index) => {
                  const page = index + 1
                  return (
                    <li key={`thumb-${page}`}>
                      <button
                        type="button"
                        className="thumb-item"
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

          {showOutline ? (
            <div className="reader-section">
              <h2>Outline</h2>
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

        <div className="reader-main">
          <div className="reader-meta-row">
            <span className="reader-status">
              Page {currentPage} / {numPages}
            </span>
            <span className="reader-status">
              Cached text: {Object.keys(textCache).length}/{numPages}
            </span>
            <span className="reader-status">{extractStatus}</span>
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
                        searchQuery={searchQuery}
                        estimatedHeight={estimatedPageHeight}
                        scrollRoot={scrollWrapRef.current}
                        onMatchCount={(pageNumber, count) =>
                          setMatchCountsByPage((current) => ({
                            ...current,
                            [pageNumber]: count,
                          }))
                        }
                        onTextCached={(pageNumber, strings) =>
                          setTextCache((current) => ({
                            ...current,
                            [pageNumber]: { strings },
                          }))
                        }
                        onVisibleChange={(pageNumber, isVisible) =>
                          setVisiblePages((current) => ({
                            ...current,
                            [pageNumber]: isVisible,
                          }))
                        }
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
