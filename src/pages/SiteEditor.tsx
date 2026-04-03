import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
// @ts-ignore — grapesjs types are loose
import grapesjs from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import {
  getSite, updateSite, addPage, removePage,
  getPageContent, savePageContent, deletePageContent, hasPageContent,
  getPageHistory, savePageHistory, clearPageHistory,
  getCmsData, saveCmsData,
} from '../lib/db';
import type { CmsFieldType, CmsField, CmsRecord, CmsCollection, CmsData } from '../lib/db';
import type { Site, SitePage, Snapshot } from '../types';

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_SNAPSHOTS = 30;

// ── Helpers ──────────────────────────────────────────────────────────────────

function captureStyles(doc: Document): string {
  return Array.from(doc.querySelectorAll('style'))
    .map(s => s.textContent ?? '').join('\n');
}

function injectCss(doc: Document, css: string) {
  doc.querySelectorAll('style[data-gjs-app]').forEach(el => el.remove());
  if (!css) return;
  const style = doc.createElement('style');
  style.setAttribute('data-gjs-app', 'true');
  style.textContent = css;
  doc.head.appendChild(style);
}

function injectLinks(doc: Document, hrefs: string[]) {
  doc.querySelectorAll('link[data-gjs-app]').forEach(el => el.remove());
  hrefs.forEach(href => {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('data-gjs-app', 'true');
    link.href = href;
    doc.head.appendChild(link);
  });
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
    ' · ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'page';
}

// ── Component ────────────────────────────────────────────────────────────────
export const SiteEditor: React.FC = () => {
  const { siteId }  = useParams<{ siteId: string }>();
  const navigate    = useNavigate();

  const [site, setSite]             = useState<Site | null>(null);
  const [activePage, setActivePage] = useState<SitePage | null>(null);
  const [status, setStatus]         = useState<'idle' | 'loading' | 'ready'>('idle');
  const [saveLabel, setSaveLabel]   = useState('Save Page');
  const [savedPages, setSavedPages] = useState<Record<string, boolean>>({});

  // Refs
  const mountRef           = useRef<HTMLDivElement>(null);
  const captureRef         = useRef<HTMLIFrameElement>(null);
  const editorRef          = useRef<any>(null);
  const capturedCssRef     = useRef('');
  const capturedLinksRef   = useRef<string[]>([]);
  const historyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePageRef      = useRef<SitePage | null>(null);

  // Claude chat state
  type Attachment = { name: string; kind: 'image' | 'pdf' | 'text'; mediaType: string; data: string; preview?: string };
  type ChatMsg    = { role: 'user' | 'assistant'; content: string; attachments?: Pick<Attachment,'name'|'kind'|'preview'>[] };

  const [chatOpen,     setChatOpen]     = useState(false);
  const [chatMsgs,     setChatMsgs]     = useState<ChatMsg[]>([]);
  const [chatInput,    setChatInput]    = useState('');
  const [chatLoading,  setChatLoading]  = useState(false);
  const [apiKey,       setApiKey]       = useState(() => localStorage.getItem('claude-api-key') ?? '');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [selectedLabel,setSelectedLabel]= useState<string | null>(null);
  const [attachments,  setAttachments]  = useState<Attachment[]>([]);
  const chatEndRef    = useRef<HTMLDivElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const mdCursorRef   = useRef<Record<string, [number, number]>>({});

  // History state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshots,   setSnapshots]   = useState<Snapshot[]>([]);
  const [lightTheme,  setLightTheme]  = useState(false);

  // CMS state (types imported from ../lib/db)
  const [cmsOpen,         setCmsOpen]         = useState(false);
  const [cmsData,         setCmsData]         = useState<CmsData>({ collections: {} });
  const [cmsView,         setCmsView]         = useState<'list' | 'table' | 'schema'>('list');
  const [activeCol,       setActiveCol]       = useState<string | null>(null);
  const [newColName,      setNewColName]      = useState('');
  const [newColFields,    setNewColFields]    = useState<CmsField[]>([{ key: 'title', label: 'Title', type: 'text' }]);
  const [cmsSnippetCol,   setCmsSnippetCol]   = useState<string | null>(null);
  const [cmsInsertLayout, setCmsInsertLayout] = useState<'list'|'grid'|'cards'|'table'>('grid');
  // Table inline editing
  const [editingCell,  setEditingCell]  = useState<{ rid: string; fkey: string } | null>(null);
  const [cellDraft,    setCellDraft]    = useState('');
  // Markdown / record modal
  const [recordModal,  setRecordModal]  = useState<CmsRecord | null>(null);
  const [modalDraft,   setModalDraft]   = useState<Record<string, string>>({});
  const [mdPreview,    setMdPreview]    = useState(false);
  const [activeTab,    setActiveTab]    = useState<string>('');   // field key open in md editor
  // Schema editor
  const [schemaFields, setSchemaFields] = useState<CmsField[]>([]);

  // Add / delete page modal state
  const [addPageOpen,  setAddPageOpen]  = useState(false);
  const [newPageName,  setNewPageName]  = useState('');
  const [newPageUrl,   setNewPageUrl]   = useState('');

  // Export modal
  const [exportHtml, setExportHtml] = useState<string | null>(null);

  // Nav state preview
  const [navForceOpen, setNavForceOpen] = useState(false);

  // Code editor panel
  const [codeEditorOpen, setCodeEditorOpen] = useState(false);
  const [codeHtml,       setCodeHtml]       = useState('');
  const [codeCss,        setCodeCss]        = useState('');
  const [codeTab,        setCodeTab]        = useState<'html' | 'css'>('html');

  // Deploy modal
  const [deployOpen,    setDeployOpen]    = useState(false);
  const [vercelToken,   setVercelToken]   = useState(() => localStorage.getItem('vercel-token') ?? '');
  const [deployStatus,  setDeployStatus]  = useState<'idle' | 'saving' | 'deploying' | 'done' | 'error'>('idle');
  const [deployUrl,     setDeployUrl]     = useState<string | null>(null);
  const [deployError,   setDeployError]   = useState<string | null>(null);

  // ── Nav force-open override ───────────────────────────────────────────────
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || status !== 'ready') return;
    const doc: Document = editor.Canvas.getDocument();
    const existing = doc.getElementById('--nav-force-open');
    if (navForceOpen) {
      if (!existing) {
        const style = doc.createElement('style');
        style.id = '--nav-force-open';
        style.textContent = [
          '.nav-links{display:flex!important;flex-direction:column!important;position:static!important;',
          'width:100%!important;gap:12px!important;padding:16px 24px!important}',
        ].join('');
        doc.head.appendChild(style);
      }
    } else {
      existing?.remove();
    }
  }, [navForceOpen, status]);

  // ── Load initial site data ─────────────────────────────────────────────────
  useEffect(() => {
    if (!siteId) return;
    getSite(siteId).then(async s => {
      if (!s) { navigate('/'); return; }
      setSite(s);
      setActivePage(s.pages[0] ?? null);
      const entries = await Promise.all(s.pages.map(async p => [p.key, await hasPageContent(siteId, p.key)] as [string, boolean]));
      setSavedPages(Object.fromEntries(entries));
    });
  }, [siteId, navigate]);

  // ── Load a page into GrapesJS ─────────────────────────────────────────────
  const loadPage = useCallback(async (page: SitePage) => {
    const editor = editorRef.current;
    if (!editor) return;

    const saved = await getPageContent(siteId!, page.key);

    // If we have saved content, use it immediately — no URL capture needed
    if (saved) {
      editor.setComponents(saved.html);
      editor.setStyle(saved.css);
      setStatus('ready');
      return;
    }

    // If there's a sourceUrl, try to capture from it
    if (page.sourceUrl) {
      const iframe = captureRef.current;
      if (!iframe) { setStatus('ready'); editor.setComponents(''); return; }

      setStatus('loading');

      const onLoad = () => {
        iframe.removeEventListener('load', onLoad);
        try {
          const doc = iframe.contentDocument;
          if (!doc) throw new Error('Cross-origin: cannot read page content. Use a local URL (e.g. http://localhost:3000).');

          const main = doc.querySelector('main') ?? doc.body;
          capturedCssRef.current   = captureStyles(doc);
          capturedLinksRef.current = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
            .map(l => l.href).filter(Boolean);

          const canvasDoc = editor.Canvas.getDocument();
          if (canvasDoc) {
            injectCss(canvasDoc, capturedCssRef.current);
            injectLinks(canvasDoc, capturedLinksRef.current);
          }

          editor.setComponents(main.innerHTML);
          setStatus('ready');
        } catch (err: any) {
          console.warn('[SiteEditor] capture failed:', err.message);
          editor.setComponents(
            `<div style="padding:40px 32px;font-family:-apple-system,sans-serif;color:#86868b">
              <p style="font-weight:600;color:#1d1d1f;margin-bottom:8px">Could not capture from URL</p>
              <p style="font-size:13px">${err.message}</p>
              <p style="font-size:13px;margin-top:6px">You can start building manually using the blocks panel →</p>
            </div>`
          );
          setStatus('ready');
        }
      };

      iframe.addEventListener('load', onLoad);
      iframe.src = page.sourceUrl;
      return;
    }

    // Blank canvas
    editor.setComponents(
      '<div style="padding:80px 32px;text-align:center;font-family:-apple-system,sans-serif;color:#86868b">' +
      '<p style="font-size:16px">Drag blocks from the panel on the right to start building.</p>' +
      '</div>'
    );
    editor.setStyle('');
    setStatus('ready');
  }, [siteId]);

  // ── Init GrapesJS once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current || editorRef.current || !site) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (grapesjs.init as any)({
      container: mountRef.current,
      fromElement: false,
      height: '100%',
      width: 'auto',
      storageManager: false,
      noticeOnUnload: false,
      allowScripts: true,
      deviceManager: {
        devices: [
          { name: 'Desktop', width: '' },
          { name: 'Tablet',  width: '768px',  widthMedia: '768px' },
          { name: 'Mobile',  width: '390px',  widthMedia: '390px' },
        ],
      },
    });

    editorRef.current = editor;

    editor.on('component:selected',   (c: any) => setSelectedLabel(c?.getName?.() ?? 'element'));
    editor.on('component:deselected', ()        => setSelectedLabel(null));

    // Auto-snapshot: debounce 3 s after any change
    const scheduleSnapshot = (label: string) => {
      if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current);
      historyDebounceRef.current = setTimeout(() => {
        const page = activePageRef.current;
        if (!page) return;
        const html = editor.getHtml();
        const css  = editor.getCss() ?? '';
        const snap: Snapshot = { ts: Date.now(), label, html, css };
        setSnapshots(prev => {
          const next = [snap, ...prev].slice(0, MAX_SNAPSHOTS);
          savePageHistory(siteId!, page.key, next); // async, fire-and-forget
          return next;
        });
      }, 3000);
    };
    editor.on('component:update', () => scheduleSnapshot('Auto-save'));
    editor.on('style:update',     () => scheduleSnapshot('Style change'));

    // Re-inject CSS whenever the canvas frame reloads
    editor.on('canvas:frame:load', () => {
      const canvasDoc = editor.Canvas.getDocument();
      if (canvasDoc) {
        if (capturedCssRef.current)          injectCss(canvasDoc, capturedCssRef.current);
        if (capturedLinksRef.current.length) injectLinks(canvasDoc, capturedLinksRef.current);
      }
    });

    // ── Custom blocks ─────────────────────────────────────────────────────
    const bm = editor.BlockManager;
    ['column1','column2','column3','column3-7','text','link','image','video','map','link-block','quote','text-basic'].forEach(id => {
      try { bm.remove(id); } catch { /* ignore */ }
    });

    const icon = (svg: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="28" height="28">${svg}</svg>`;

    // Layout
    bm.add('section-1',  { label: '1 Column',   category: 'Layout', media: icon('<rect x="2" y="4" width="20" height="16" rx="2"/>'), content: '<section style="padding:64px 32px"><div style="max-width:1120px;margin:0 auto"><p>Section content goes here.</p></div></section>' });
    bm.add('section-2',  { label: '2 Columns',  category: 'Layout', media: icon('<rect x="2" y="4" width="9" height="16" rx="1"/><rect x="13" y="4" width="9" height="16" rx="1"/>'), content: '<div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;padding:64px 32px"><div><p>Left column</p></div><div><p>Right column</p></div></div>' });
    bm.add('section-3',  { label: '3 Columns',  category: 'Layout', media: icon('<rect x="2" y="4" width="5.5" height="16" rx="1"/><rect x="9.25" y="4" width="5.5" height="16" rx="1"/><rect x="16.5" y="4" width="5.5" height="16" rx="1"/>'), content: '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;padding:64px 32px"><div><p>Col 1</p></div><div><p>Col 2</p></div><div><p>Col 3</p></div></div>' });
    bm.add('section-37', { label: '3/7 Split',  category: 'Layout', media: icon('<rect x="2" y="4" width="8" height="16" rx="1"/><rect x="12" y="4" width="10" height="16" rx="1"/>'), content: '<div style="display:grid;grid-template-columns:3fr 4fr;gap:32px;padding:64px 32px"><div><p>Sidebar</p></div><div><p>Main content</p></div></div>' });

    // Content
    bm.add('text',         { label: 'Text',         category: 'Content', media: icon('<path d="M4 6h16M4 10h16M4 14h10"/>'), content: '<p style="font-size:16px;line-height:1.7;color:#1d1d1f">Your text here.</p>' });
    bm.add('heading',      { label: 'Heading',       category: 'Content', media: icon('<path d="M4 6h4m0 0v12m0-6h8m0-6h4m0 0v12"/>'), content: '<h2 style="font-size:2rem;font-weight:700;letter-spacing:-0.02em;color:#1d1d1f;margin-bottom:16px">Section heading</h2>' });
    bm.add('text-section', { label: 'Text Section',  category: 'Content', media: icon('<path d="M4 5h16M4 9h12M4 13h16M4 17h8"/>'), content: '<div style="padding:64px 32px"><div style="max-width:680px"><p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#0066cc;margin-bottom:12px">Label</p><h2 style="font-size:2rem;font-weight:700;color:#1d1d1f;margin-bottom:16px">Section heading</h2><p style="font-size:18px;line-height:1.7;color:#86868b">Supporting body copy.</p></div></div>' });
    bm.add('quote',        { label: 'Quote',         category: 'Content', media: icon('<path d="M3 21l2-6a9 9 0 1 1 3.2 3.2L3 21"/>'), content: '<blockquote style="border-left:4px solid #0066cc;padding:16px 24px;margin:24px 0;background:#f5f5f7;border-radius:0 12px 12px 0"><p style="font-style:italic;color:#86868b;line-height:1.7">An insightful quote or callout text.</p></blockquote>' });
    bm.add('image',        { label: 'Image',         category: 'Content', media: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'), content: '<figure style="margin:24px 0"><img src="https://placehold.co/1200x600" alt="Image" style="width:100%;border-radius:16px;display:block"/><figcaption style="text-align:center;font-size:12px;color:#86868b;margin-top:8px">Caption</figcaption></figure>' });
    bm.add('divider',      { label: 'Divider',       category: 'Content', media: icon('<line x1="3" y1="12" x2="21" y2="12"/>'), content: '<hr style="border:none;border-top:1px solid #d2d2d7;margin:32px 0"/>' });

    // Interactive
    bm.add('button',     { label: 'Button',     category: 'Interactive', media: icon('<rect x="3" y="8" width="18" height="8" rx="9999"/>'), content: '<a href="#" style="display:inline-block;background:#0066cc;color:#fff;padding:14px 28px;border-radius:9999px;font-size:16px;font-weight:500;text-decoration:none">Button label</a>' });
    bm.add('link',       { label: 'Link',       category: 'Interactive', media: icon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'), content: '<a href="#" style="color:#0066cc;font-size:16px;text-decoration:none">Link text →</a>' });
    bm.add('link-block', { label: 'Link Block', category: 'Interactive', media: icon('<rect x="3" y="5" width="18" height="14" rx="2"/>'), content: '<a href="#" style="display:block;padding:24px;border:1px solid #d2d2d7;border-radius:16px;text-decoration:none;color:inherit"><p style="font-weight:600;color:#1d1d1f;margin-bottom:6px">Card title</p><p style="font-size:14px;color:#86868b">Short description</p></a>' });
    bm.add('form',       { label: 'Form',       category: 'Interactive', media: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><line x1="7" y1="10" x2="17" y2="10"/><line x1="7" y1="14" x2="13" y2="14"/>'), content: '<form style="display:flex;flex-direction:column;gap:12px;max-width:400px"><input type="text" placeholder="Name" style="border:1px solid #d2d2d7;border-radius:8px;padding:10px 14px;font-size:14px"/><input type="email" placeholder="Email" style="border:1px solid #d2d2d7;border-radius:8px;padding:10px 14px;font-size:14px"/><button type="submit" style="background:#0066cc;color:#fff;border:none;border-radius:9999px;padding:12px 24px;font-size:14px;font-weight:600;cursor:pointer">Submit</button></form>' });

    // Collections
    bm.add('grid-items', { label: 'Card Grid', category: 'Collections', media: icon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'), content: '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:32px 0">' + ['1','2','3'].map(() => '<div style="border:1px solid #d2d2d7;border-radius:16px;padding:24px"><p style="font-weight:600;color:#1d1d1f;margin-bottom:8px">Card title</p><p style="font-size:14px;color:#86868b">Description text goes here.</p></div>').join('') + '</div>' });
    bm.add('list-items', { label: 'List',       category: 'Collections', media: icon('<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/>'), content: '<ul style="list-style:none;padding:0;margin:0">' + ['Item one','Item two','Item three'].map(t => `<li style="display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid #d2d2d7"><span style="width:8px;height:8px;border-radius:50%;background:#0066cc;flex-shrink:0;margin-top:6px"></span><span style="color:#1d1d1f">${t}</span></li>`).join('') + '</ul>' });
    bm.add('stats',      { label: 'Stats',      category: 'Collections', media: icon('<path d="M3 20h18M3 20V10l6-4 4 4 5-6v16"/>'), content: '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:48px 32px">' + [['98%','Satisfaction'],['2× faster','Delivery'],['40+','Projects']].map(([v,l]) => `<div style="text-align:center;background:#f5f5f7;border-radius:16px;padding:24px"><p style="font-size:2rem;font-weight:700;color:#0066cc;margin-bottom:4px">${v}</p><p style="font-size:13px;color:#86868b">${l}</p></div>`).join('') + '</div>' });

    // Load first page
    const firstPage = site.pages[0];
    if (firstPage) {
      activePageRef.current = firstPage;
      setActivePage(firstPage);
      getPageHistory(siteId!, firstPage.key).then(setSnapshots);
      loadPage(firstPage);
    }

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [site, siteId, loadPage]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSelectPage = async (page: SitePage) => {
    setActivePage(page);
    activePageRef.current = page;
    setSaveLabel('Save Page');
    setSnapshots(await getPageHistory(siteId!, page.key));
    loadPage(page);
  };

  const handleSave = async () => {
    const editor = editorRef.current;
    if (!editor || status !== 'ready' || !activePage) return;
    const html = editor.getHtml();
    const css  = editor.getCss() ?? '';
    await savePageContent(siteId!, activePage.key, html, css);
    setSavedPages(prev => ({ ...prev, [activePage.key]: true }));
    setSite(await getSite(siteId!));
    setSaveLabel('✓ Saved!');
    setTimeout(() => setSaveLabel('Save Page'), 2000);
    // Save to disk via dev server endpoint (dev-only, fails silently in prod)
    fetch('/api/save-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, pageKey: activePage.key, pageLabel: activePage.label, html, css }),
    }).catch(() => {});
  };

  const handleReset = async () => {
    if (!activePage) return;
    if (!confirm(`Reset "${activePage.label}"? Saved content will be cleared and the page reloaded.`)) return;
    await deletePageContent(siteId!, activePage.key);
    setSavedPages(prev => ({ ...prev, [activePage.key]: false }));
    loadPage(activePage);
  };

  const handleDevice = (name: string) => editorRef.current?.setDevice(name);
  const handleUndo   = () => editorRef.current?.runCommand('core:undo');
  const handleRedo   = () => editorRef.current?.runCommand('core:redo');

  const handleExport = () => {
    const editor = editorRef.current;
    if (!editor || !activePage) return;
    const html = editor.getHtml();
    const css  = editor.getCss() ?? '';
    const full = `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${activePage.label}</title>\n  <style>\n${css}\n  </style>\n</head>\n<body>\n${html}\n</body>\n</html>`;
    setExportHtml(full);
  };

  const handleDownloadExport = () => {
    if (!exportHtml || !activePage) return;
    const blob = new Blob([exportHtml], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${activePage.key}.html`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Code editor panel ────────────────────────────────────────────────────
  const openCodeEditor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    setCodeHtml(editor.getHtml());
    setCodeCss(editor.getCss() ?? '');
    setCodeTab('html');
    setCodeEditorOpen(true);
  };

  const applyCodeEditorChanges = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setComponents(codeHtml);
    editor.setStyle(codeCss);
  };

  // ── CMS helpers ──────────────────────────────────────────────────────────
  const cmsLoad = useCallback(async () => {
    if (!siteId) return;
    const data = await getCmsData(siteId);
    setCmsData(data);
  }, [siteId]);

  useEffect(() => { if (cmsOpen) cmsLoad(); }, [cmsOpen, cmsLoad]);

  const cmsSave = async (next: CmsData) => {
    setCmsData(next);
    await saveCmsData(siteId!, next);
  };

  const cmsSlug = (name: string) =>
    name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40);

  const cmsCreateCollection = async () => {
    if (!newColName.trim()) return;
    const key = cmsSlug(newColName);
    const next: CmsData = {
      collections: {
        ...cmsData.collections,
        [key]: { label: newColName.trim(), fields: newColFields, records: [] },
      },
    };
    await cmsSave(next);
    setNewColName('');
    setNewColFields([{ key: 'title', label: 'Title', type: 'text' }]);
    setActiveCol(key);
    setCmsView('table');
  };

  const cmsDeleteCollection = async (key: string) => {
    if (!confirm(`Delete collection "${cmsData.collections[key]?.label}"? All records will be lost.`)) return;
    const next = { collections: { ...cmsData.collections } };
    delete next.collections[key];
    await cmsSave(next);
    setCmsView('list');
    setActiveCol(null);
  };

  const updateCellValue = async (colKey: string, rid: string, fkey: string, val: string) => {
    const col = cmsData.collections[colKey];
    if (!col) return;
    const records = col.records.map(r => r.id === rid ? { ...r, [fkey]: val } : r);
    await cmsSave({ collections: { ...cmsData.collections, [colKey]: { ...col, records } } });
  };

  const cmsAddRecord = async (colKey: string) => {
    const col = cmsData.collections[colKey];
    if (!col) return;
    const newId = Date.now().toString(36);
    const empty: CmsRecord = { id: newId };
    col.fields.forEach(f => { empty[f.key] = ''; });
    await cmsSave({ collections: { ...cmsData.collections, [colKey]: { ...col, records: [...col.records, empty] } } });
    const firstText = col.fields.find(f => f.type !== 'image-url' && f.type !== 'textarea');
    if (firstText) { setEditingCell({ rid: newId, fkey: firstText.key }); setCellDraft(''); }
  };

  const cmsSaveSchema = async (colKey: string) => {
    const col = cmsData.collections[colKey];
    if (!col) return;
    await cmsSave({ collections: { ...cmsData.collections, [colKey]: { ...col, fields: schemaFields } } });
    setCmsView('table');
  };

  const cmsSaveModalRecord = async (colKey: string) => {
    if (!recordModal) return;
    await updateCellValue(colKey, recordModal.id, Object.keys(modalDraft)[0] ?? '', '');
    const col = cmsData.collections[colKey];
    if (!col) return;
    const records = col.records.map(r => r.id === recordModal.id ? { ...r, ...modalDraft } : r);
    await cmsSave({ collections: { ...cmsData.collections, [colKey]: { ...col, records } } });
    setRecordModal(null);
  };

  const renderMd = (md: string): string => {
    if (!md) return '<span style="color:#aaa">Empty</span>';
    let h = md
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/^### (.+)$/gm,'<h3 style="font-size:15px;font-weight:700;color:#1d1d1f;margin:10px 0 4px">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 style="font-size:18px;font-weight:700;color:#1d1d1f;margin:14px 0 6px">$1</h2>')
      .replace(/^# (.+)$/gm,  '<h1 style="font-size:22px;font-weight:700;color:#1d1d1f;margin:16px 0 8px">$1</h1>')
      .replace(/^---$/gm,'<hr style="border:none;border-top:1px solid #d2d2d7;margin:14px 0"/>')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/`(.+?)`/g,'<code style="background:#f5f5f7;padding:2px 5px;border-radius:4px;font-size:12px;color:#c41e3a">$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img src="$2" alt="$1" style="max-width:100%;border-radius:6px;margin:6px 0;display:block"/>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" style="color:#0066cc;text-decoration:underline">$1</a>')
      .replace(/^[*-] (.+)$/gm,'<li style="margin:2px 0;color:#1d1d1f;margin-left:16px">$1</li>')
      .replace(/^\d+\. (.+)$/gm,'<li style="margin:2px 0;color:#1d1d1f;margin-left:16px">$1</li>')
      .replace(/\n\n+/g,'</p><p style="color:#1d1d1f;margin:0 0 8px;line-height:1.65">')
      .replace(/\n/g,'<br/>');
    return `<p style="color:#1d1d1f;margin:0 0 8px;line-height:1.65">${h}</p>`;
  };

  const cmsDeleteRecord = async (colKey: string, recordId: string) => {
    const col = cmsData.collections[colKey];
    if (!col) return;
    const next: CmsData = {
      collections: { ...cmsData.collections, [colKey]: { ...col, records: col.records.filter(r => r.id !== recordId) } },
    };
    await cmsSave(next);
  };

  const cmsReorderRecord = async (colKey: string, recordId: string, dir: -1 | 1) => {
    const col = cmsData.collections[colKey];
    if (!col) return;
    const idx = col.records.findIndex(r => r.id === recordId);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= col.records.length) return;
    const records = [...col.records];
    [records[idx], records[newIdx]] = [records[newIdx], records[idx]];
    await cmsSave({ collections: { ...cmsData.collections, [colKey]: { ...col, records } } });
  };

  const compressImage = (dataUrl: string): Promise<string> =>
    new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1200;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.src = dataUrl;
    });

  const cmsInsertSnippet = (colKey: string, layout: 'list'|'grid'|'cards'|'table') => {
    const editor = editorRef.current;
    if (!editor) return;
    const col = cmsData.collections[colKey];
    if (!col) return;
    const firstField  = col.fields[0]?.key ?? 'title';
    const secondField = col.fields[1]?.key ?? null;
    const imageField  = col.fields.find(f => f.type === 'image-url')?.key ?? null;
    const textFields  = col.fields.filter(f => f.key !== imageField && f.key !== firstField);

    const renderCard = (r: Record<string, string>, extraStyle = '') => {
      const img   = imageField && r[imageField]
        ? `<img src="${r[imageField]}" style="width:100%;height:160px;object-fit:cover;display:block" />`
        : '';
      const body  = textFields.map(f => r[f.key] ? `<p style="color:#86868b;font-size:13px;margin:4px 0 0">${r[f.key]}</p>` : '').join('');
      return `<div style="border:1px solid #d2d2d7;border-radius:12px;overflow:hidden;background:#fff${extraStyle}">${img}<div style="padding:14px"><p style="font-weight:600;color:#1d1d1f;margin:0;font-size:15px">${r[firstField] || 'Untitled'}</p>${body}</div></div>`;
    };

    let inner = '';
    if (col.records.length === 0) {
      inner = '<p style="color:#86868b;font-size:14px">No records yet.</p>';
    } else if (layout === 'grid') {
      inner = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px">${col.records.map(r => renderCard(r)).join('')}</div>`;
    } else if (layout === 'list') {
      inner = col.records.map(r => renderCard(r, ';margin-bottom:12px')).join('');
    } else if (layout === 'cards') {
      inner = col.records.map(r => {
        const img  = imageField && r[imageField] ? `<img src="${r[imageField]}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;flex-shrink:0" />` : '';
        const body = textFields.map(f => r[f.key] ? `<p style="color:#86868b;font-size:13px;margin:4px 0 0">${r[f.key]}</p>` : '').join('');
        return `<div style="display:flex;gap:16px;align-items:flex-start;border:1px solid #d2d2d7;border-radius:12px;overflow:hidden;background:#fff;margin-bottom:12px;padding:14px">${img}<div><p style="font-weight:600;color:#1d1d1f;margin:0;font-size:15px">${r[firstField] || 'Untitled'}</p>${body}</div></div>`;
      }).join('');
    } else if (layout === 'table') {
      const headers = col.fields.filter(f => f.type !== 'image-url').map(f => `<th style="text-align:left;padding:10px 14px;border-bottom:2px solid #d2d2d7;font-size:12px;color:#86868b;font-weight:600;text-transform:uppercase;letter-spacing:.05em">${f.label}</th>`).join('');
      const rows    = col.records.map(r => {
        const cells = col.fields.filter(f => f.type !== 'image-url').map(f => `<td style="padding:10px 14px;border-bottom:1px solid #f0f0f5;font-size:14px;color:#1d1d1f">${r[f.key] || ''}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      inner = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #d2d2d7"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    const snippet = `<section id="cms-${colKey}" data-cms="${colKey}" data-cms-layout="${layout}" style="padding:40px 0"><div style="max-width:960px;margin:0 auto;padding:0 24px"><h2 style="font-size:28px;font-weight:700;color:#1d1d1f;margin-bottom:24px">${col.label}</h2>${inner}</div></section>`;
    editor.setComponents((editor.getHtml() || '') + snippet);
    setCmsSnippetCol(null);
    setCmsOpen(false);
  };

  const handleDeploy = async () => {
    if (!site || !activePage || !vercelToken) return;
    const editor = editorRef.current;
    if (!editor) return;
    setDeployStatus('saving');
    setDeployError(null);
    setDeployUrl(null);
    // Save all pages first
    const pages = site.pages;
    for (const page of pages) {
      // Use current editor state for active page, stored content for others
      let html: string, css: string;
      if (page.key === activePage.key) {
        html = editor.getHtml();
        css  = editor.getCss() ?? '';
      } else {
        const stored = await getPageContent(siteId!, page.key);
        if (!stored) continue;
        html = stored.html;
        css  = stored.css;
      }
      await fetch('/api/save-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, pageKey: page.key, pageLabel: page.label, html, css }),
      });
    }
    setDeployStatus('deploying');
    try {
      const res = await fetch('/api/deploy-vercel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, siteName: site.name, vercelToken }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setDeployStatus('error');
        setDeployError(data.error ?? 'Deployment failed.');
      } else {
        setDeployStatus('done');
        setDeployUrl(data.url);
      }
    } catch (err: any) {
      setDeployStatus('error');
      setDeployError(err.message);
    }
  };

  // Add page
  const handleAddPage = async () => {
    if (!newPageName.trim()) return;
    const key = slugify(newPageName);
    const current = site?.pages.map(p => p.key) ?? [];
    let uniqueKey = key; let i = 2;
    while (current.includes(uniqueKey)) { uniqueKey = `${key}-${i}`; i++; }
    const newPage: SitePage = { key: uniqueKey, label: newPageName.trim(), sourceUrl: newPageUrl.trim() || undefined };
    await addPage(siteId!, newPage);
    setSite(await getSite(siteId!));
    setNewPageName(''); setNewPageUrl(''); setAddPageOpen(false);
    handleSelectPage(newPage);
  };

  // Delete page
  const handleDeletePage = async (page: SitePage) => {
    if (!site || site.pages.length <= 1) { alert('A site must have at least one page.'); return; }
    if (!confirm(`Remove page "${page.label}"? Saved content for this page will be lost.`)) return;
    await removePage(siteId!, page.key);
    const updated = await getSite(siteId!);
    setSite(updated);
    if (activePage?.key === page.key && updated?.pages[0]) handleSelectPage(updated.pages[0]);
  };

  // Claude chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMsgs]);

  const addFileAsAttachment = (file: File) => {
    const reader = new FileReader();
    if (file.type.startsWith('image/')) {
      reader.readAsDataURL(file);
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setAttachments(prev => [...prev, { name: file.name || 'image.png', kind: 'image', mediaType: file.type || 'image/png', data: dataUrl.split(',')[1], preview: dataUrl }]);
      };
    } else if (file.type === 'application/pdf') {
      reader.readAsDataURL(file);
      reader.onload = () => setAttachments(prev => [...prev, { name: file.name, kind: 'pdf', mediaType: 'application/pdf', data: (reader.result as string).split(',')[1] }]);
    } else {
      reader.readAsText(file);
      reader.onload = () => setAttachments(prev => [...prev, { name: file.name, kind: 'text', mediaType: file.type || 'text/plain', data: reader.result as string }]);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files ?? []).forEach(addFileAsAttachment);
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(it => it.kind === 'file' && it.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    imageItems.forEach(it => {
      const file = it.getAsFile();
      if (file) addFileAsAttachment(file);
    });
  };

  // Stream a Claude response, calling onChunk with each text delta and returning the full text
  const streamClaude = async (messages: any[], system: string, onChunk: (partial: string) => void): Promise<string> => {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8000, system, messages }),
    });

    // Non-streaming error response (JSON)
    if (!res.ok || res.headers.get('content-type')?.includes('application/json')) {
      const text = await res.text();
      try { const d = JSON.parse(text); return `Error: ${d.error?.message ?? d.error ?? text.slice(0, 200)}`; }
      catch { return `Error: ${text.slice(0, 200)}`; }
    }

    // Read SSE stream
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const event = JSON.parse(payload);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            fullText += event.delta.text;
            onChunk(fullText);
          } else if (event.type === 'error') {
            return `Error: ${event.error?.message ?? JSON.stringify(event.error)}`;
          }
        } catch { /* incomplete JSON chunk, skip */ }
      }
    }

    return fullText || 'No response received.';
  };

  const handleClaudeChat = async () => {
    const text = chatInput.trim();
    if ((!text && attachments.length === 0) || chatLoading) return;

    const selected     = editorRef.current?.getSelected();
    const selectedHtml = selected ? selected.toHTML() : null;

    // Build multimodal content for the new user message
    const apiContent: any[] = [];
    attachments.forEach(att => {
      if (att.kind === 'image') {
        apiContent.push({ type: 'image', source: { type: 'base64', media_type: att.mediaType, data: att.data } });
      } else if (att.kind === 'pdf') {
        apiContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: att.data } });
      } else {
        apiContent.push({ type: 'text', text: `[File: ${att.name}]\n\`\`\`\n${att.data.slice(0, 60000)}\n\`\`\`` });
      }
    });
    if (text) apiContent.push({ type: 'text', text });

    const userMsg: ChatMsg = {
      role: 'user',
      content: text || `[${attachments.length} file${attachments.length !== 1 ? 's' : ''} attached]`,
      attachments: attachments.map(a => ({ name: a.name, kind: a.kind, preview: a.preview })),
    };
    setChatMsgs(prev => [...prev, userMsg]);
    setChatInput('');
    setAttachments([]);
    setChatLoading(true);

    const hasSelection = !!(selected && selected !== editorRef.current?.getWrapper());
    const system = `You are a web design assistant helping build and refine websites in GrapesJS.
Design system: primary #0066cc, text #1d1d1f, grey #86868b, surface #f5f5f7, border #d2d2d7.
Font: -apple-system / SF Pro. Apple-influenced minimalism — generous whitespace, tight type.
Card radius 24px, button radius 9999px, section padding 96px top+bottom.
${hasSelection ? `\nCurrently selected element:\n\`\`\`html\n${selectedHtml!.slice(0, 3000)}\n\`\`\`` : ''}

ABSOLUTE RULES (apply to every single HTML output, no exceptions):

1. NO JAVASCRIPT EVER — GrapesJS canvas does not execute <script> tags. All interactions (menus, toggles, tabs, accordions) MUST use pure CSS only: checkbox hack (:checked), :hover, :focus, :target.

2. MANDATORY BASELINE — every HTML output MUST start with this <style> block (add it before any other styles):
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{overflow-x:hidden;width:100%;max-width:100%}
img,video,iframe,svg{max-width:100%;height:auto;display:block}
.container{width:100%;max-width:1200px;margin:0 auto;padding:0 clamp(16px,5vw,48px)}
</style>

3. FLUID LAYOUTS ONLY:
- All font sizes: use clamp(min, preferred, max) — e.g. clamp(1rem, 2.5vw, 1.125rem)
- All headings: clamp(1.5rem, 5vw, 3.5rem)
- Never use fixed pixel widths on any block element — use %, max-width, or minmax()
- Grids: use grid-template-columns: repeat(auto-fit, minmax(min(280px,100%), 1fr)) instead of fixed columns
- Sections: padding: clamp(48px, 8vw, 96px) clamp(16px, 5vw, 48px)
- Never use position:absolute on elements that would overflow at narrow widths without overflow:hidden on the parent

4. BREAKPOINTS: include at minimum @media(max-width:768px) and @media(max-width:480px) in every page

OUTPUT FORMAT — choose one:

A) STYLING CHANGE (color, gradient, shadow, border, padding, etc.):
   → Output a \`\`\`css block with ONLY the CSS properties to change. Applied directly to selected element.

B) STRUCTURAL / CONTENT CHANGE (add sections, build a page, rewrite, add nav, etc.):
   → Output a \`\`\`html block with body content only (no <!DOCTYPE>, <html>, <head>, <body> tags).
   → Put ALL CSS in a <style> tag first inside the block.

RESPONSIVENESS RULES (always apply when building pages):
- Use max-width containers: <div style="max-width:1200px;margin:0 auto;padding:0 24px">
- Use flexbox with flex-wrap:wrap and min-width on children instead of fixed grid columns
- Use clamp() for font sizes: font-size:clamp(1.5rem,4vw,3rem)
- Never use fixed pixel widths on sections — use width:100% or percentages
- Images: width:100%;height:auto;display:block

HAMBURGER MENU — CRITICAL: GrapesJS canvas does NOT reliably execute <script> tags. NEVER use JavaScript for hamburger menus. Use ONLY the CSS-only checkbox pattern below. COPY THIS STRUCTURE EXACTLY — do not change the element nesting:
<style>
  #nav-toggle { display: none; }
  .hamburger { display: none; cursor: pointer; flex-direction: column; gap: 5px; padding: 4px; background: none; border: none; }
  .hamburger span { width: 24px; height: 2px; background: currentColor; display: block; transition: 0.3s; }
  .nav-links { display: flex; align-items: center; gap: 24px; list-style: none; margin: 0; padding: 0; }
  @media (max-width: 768px) {
    .hamburger { display: flex; }
    .nav-links { display: none; flex-direction: column; align-items: flex-start; position: absolute; top: 100%; left: 0; right: 0; background: inherit; padding: 16px 24px; gap: 12px; border-top: 1px solid rgba(0,0,0,0.1); z-index: 999; }
    /* :has() works regardless of where #nav-toggle sits inside nav */
    nav:has(#nav-toggle:checked) .nav-links { display: flex; }
    /* Fallback: checkbox is a direct child of nav */
    nav > #nav-toggle:checked ~ .nav-links { display: flex; }
    nav:has(#nav-toggle:checked) .hamburger span:nth-child(1) { transform: rotate(45deg) translate(5px,5px); }
    nav:has(#nav-toggle:checked) .hamburger span:nth-child(2) { opacity: 0; }
    nav:has(#nav-toggle:checked) .hamburger span:nth-child(3) { transform: rotate(-45deg) translate(5px,-5px); }
  }
</style>
<!-- EXACT structure — keep checkbox, label, and nav-links all direct children of nav -->
<nav style="position:relative">
  <input type="checkbox" id="nav-toggle">
  <div class="nav-brand">Logo</div>
  <label for="nav-toggle" class="hamburger"><span></span><span></span><span></span></label>
  <ul class="nav-links">
    <li><a href="#">Home</a></li>
    <li><a href="#">About</a></li>
  </ul>
</nav>

CONVERSATION RULE (critical): After every code block, you MUST add 1–2 sentences of natural conversation — what you did, what you noticed, or a specific follow-up suggestion. Never end your response with just a code block.

Always pick ONE format (css or html) — never both.`;

    const historyMsgs = chatMsgs.map(m => ({ role: m.role, content: m.content }));
    const newMsg = { role: 'user' as const, content: apiContent.length === 1 && apiContent[0].type === 'text' ? apiContent[0].text : apiContent };

    // Add a placeholder assistant message that we'll update as chunks arrive
    setChatMsgs(prev => [...prev, { role: 'assistant', content: '…' }]);

    try {
      const reply = await streamClaude([...historyMsgs, newMsg], system, (partial) => {
        setChatMsgs(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: partial };
          return next;
        });
      });

      // Finalize the message
      setChatMsgs(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: reply };
        return next;
      });

      // Auto-apply
      setTimeout(() => {
        if (/```css/i.test(reply))       applyClaudeCss(reply);
        else if (/```html/i.test(reply)) applyClaudeHtml(reply);
      }, 100);
    } catch (err: any) {
      setChatMsgs(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: `Error: ${err.message}` };
        return next;
      });
    }
    setChatLoading(false);
  };

  // Send a predefined prompt without typing in the chat box
  const sendQuickPrompt = (prompt: string) => {
    setChatOpen(true);
    setChatInput(prompt);
    setTimeout(() => {
      setChatInput('');
      // Directly fire the same flow as handleClaudeChat with this text
      const editor = editorRef.current;
      const html = editor ? editor.getHtml() : '';
      const system = `You are a web design assistant. Fix the following page to work perfectly at ALL viewport widths — from 320px to 4K — with zero horizontal scrolling. Rules: (1) Add *,*::before,*::after{box-sizing:border-box} and html,body{overflow-x:hidden;width:100%;max-width:100%} and img{max-width:100%;height:auto} as the very first CSS. (2) Replace all fixed pixel widths with %, max-width, or minmax(). (3) Use clamp() for all font sizes. (4) Use repeat(auto-fit,minmax(min(280px,100%),1fr)) for any grid. (5) CSS-only checkbox hamburger: place <input type="checkbox" id="nav-toggle">, <label for="nav-toggle" class="hamburger">, and <ul class="nav-links"> as DIRECT children of <nav>. Use nav:has(#nav-toggle:checked) .nav-links{display:flex} and nav > #nav-toggle:checked ~ .nav-links{display:flex} (fallback). Never use JavaScript. (6) Include @media(max-width:768px) and @media(max-width:480px). Output a \`\`\`html block with the complete fixed page. After the code block, briefly describe what you fixed.\n\nCurrent page HTML:\n\`\`\`html\n${html.slice(0, 12000)}\n\`\`\``;
      const userMsg: ChatMsg = { role: 'user', content: prompt };
      setChatMsgs(prev => [...prev, userMsg, { role: 'assistant', content: '…' }]);
      setChatLoading(true);
      streamClaude([{ role: 'user', content: prompt }], system, (partial) => {
        setChatMsgs(prev => { const next = [...prev]; next[next.length - 1] = { role: 'assistant', content: partial }; return next; });
      }).then(reply => {
        setChatMsgs(prev => { const next = [...prev]; next[next.length - 1] = { role: 'assistant', content: reply }; return next; });
        setTimeout(() => { if (/```html/i.test(reply)) applyClaudeHtml(reply); }, 100);
        setChatLoading(false);
      }).catch(err => {
        setChatMsgs(prev => { const next = [...prev]; next[next.length - 1] = { role: 'assistant', content: `Error: ${err.message}` }; return next; });
        setChatLoading(false);
      });
    }, 50);
  };

  // Apply a CSS-only response to the selected element (or body if nothing selected)
  const applyClaudeCss = (msgContent: string) => {
    const match = msgContent.match(/```css\s*([\s\S]*?)(?:```|$)/i);
    if (!match) return;
    const cssText = match[1].trim();
    if (!cssText) return;
    const editor = editorRef.current;
    if (!editor) return;
    // Parse "property: value;" pairs
    const styleObj: Record<string, string> = {};
    cssText.split(';').forEach(line => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return;
      const prop = line.slice(0, colonIdx).trim();
      const val  = line.slice(colonIdx + 1).trim();
      if (prop && val) styleObj[prop] = val;
    });
    if (Object.keys(styleObj).length === 0) return;
    try {
      const sel     = editor.getSelected();
      const wrapper = editor.getWrapper?.();
      const target  = (sel && sel !== wrapper) ? sel : wrapper;
      if (target) {
        const existing = target.getStyle?.() ?? {};
        target.setStyle?.({ ...existing, ...styleObj });
      }
    } catch (err: any) {
      console.error('[Claude CSS Apply]', err.message);
    }
  };

  const applyClaudeHtml = (msgContent: string) => {
    // ── Step 1: extract the code block ──────────────────────────────────────
    // Greedy match — no closing ``` required (Claude often truncates before it)
    const openMatch = msgContent.match(/```html\s*([\s\S]*)/);
    if (!openMatch) return;
    // Strip closing ``` if present, plus anything after it
    let html = openMatch[1].replace(/```[\s\S]*$/, '').trim();
    if (!html) return;

    const editor = editorRef.current;
    if (!editor) return;

    // ── Step 2: extract CSS from <head> before stripping it ─────────────────
    let headCss = '';
    if (/<!DOCTYPE/i.test(html) || /<html[\s>]/i.test(html)) {
      const bodyIdx = html.search(/<body[\s>]/i);
      const headSection = bodyIdx > 0 ? html.slice(0, bodyIdx) : html;
      const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
      let m: RegExpExecArray | null;
      while ((m = styleRe.exec(headSection)) !== null) headCss += m[1] + '\n';
    }

    // ── Step 3: strip full-document boilerplate ──────────────────────────────
    if (/<!DOCTYPE/i.test(html) || /<html[\s>]/i.test(html)) {
      // Find where <body> starts
      const bodyTagMatch = html.match(/<body[^>]*>/i);
      if (bodyTagMatch && bodyTagMatch.index != null) {
        // Slice from end of <body ...> to end of string (or </body>)
        html = html
          .slice(bodyTagMatch.index + bodyTagMatch[0].length)
          .replace(/<\/body[\s\S]*$/i, '')
          .trim();
      } else {
        // Response was cut off inside <head> — <body> tag never appeared.
        html = html
          .replace(/<!DOCTYPE[^>]*>/gi, '')
          .replace(/<html[^>]*>/gi, '')
          .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
          .replace(/<head[^>]*>[\s\S]*/gi, '')
          .replace(/<\/html>/gi, '')
          .trim();
      }
    }

    if (!html) return;

    // ── Step 4: apply to GrapesJS canvas ────────────────────────────────────
    try {
      const sel     = editor.getSelected();
      const wrapper = editor.getWrapper?.();
      if (!sel || sel === wrapper || sel.get?.('tagName') === 'body') {
        editor.setComponents(html);
        if (headCss) editor.setStyle(headCss);
      } else {
        sel.components().reset();
        sel.append(html);
      }
    } catch (err: any) {
      console.error('[Claude Apply]', err.message);
    }
  };

  // Snapshots
  const handleRestoreSnapshot = (snap: Snapshot) => {
    if (!confirm(`Restore snapshot from ${formatTs(snap.ts)}? Unsaved changes will be lost.`)) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.setComponents(snap.html);
    editor.setStyle(snap.css);
    setHistoryOpen(false);
  };

  const handleClearHistory = async () => {
    if (!activePage || !confirm('Clear all history for this page?')) return;
    await clearPageHistory(siteId!, activePage.key);
    setSnapshots([]);
  };

  // ── Guard ─────────────────────────────────────────────────────────────────
  if (!site) return null;

  const saved = saveLabel.startsWith('✓');
  const pages = site.pages;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: lightTheme ? '#e8e8ed' : '#1a1a1a' }}>

      {/* ── Top toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', height: 48, flexShrink: 0, background: lightTheme ? '#f5f5f7' : '#111', borderBottom: `1px solid ${lightTheme ? '#d2d2d7' : '#2a2a2a'}` }}>

        {/* Back */}
        <button
          onClick={() => navigate('/')}
          style={{ color: lightTheme ? '#86868b' : '#555', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', paddingRight: 8, flexShrink: 0 }}
        >
          ← Sites
        </button>
        <span style={{ color: lightTheme ? '#1d1d1f' : '#999', fontSize: 12, fontWeight: 600, flexShrink: 0, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {site.name}
        </span>
        <div style={{ width: 1, height: 20, background: lightTheme ? '#d2d2d7' : '#2a2a2a', flexShrink: 0 }} />

        {/* Page tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, overflowX: 'auto', flex: 1, minWidth: 0 }}>
          {pages.map(p => (
            <div key={p.key} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <button
                onClick={() => handleSelectPage(p)}
                style={{
                  padding: '4px 10px', borderRadius: 9999, fontSize: 12,
                  fontWeight: activePage?.key === p.key ? 600 : 400,
                  background: activePage?.key === p.key ? '#0066cc' : 'transparent',
                  color: activePage?.key === p.key ? '#fff' : '#888',
                  border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {p.label}
                {savedPages[p.key] && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />}
              </button>
              {pages.length > 1 && (
                <button
                  onClick={() => handleDeletePage(p)}
                  title="Remove page"
                  style={{ fontSize: 10, color: '#444', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                >×</button>
              )}
            </div>
          ))}
          <button
            onClick={() => setAddPageOpen(true)}
            title="Add page"
            style={{ padding: '4px 8px', borderRadius: 9999, fontSize: 11, background: 'transparent', color: '#555', border: '1px dashed #333', cursor: 'pointer', flexShrink: 0 }}
          >
            + Page
          </button>
        </div>

        {/* Status */}
        {status === 'loading' && (
          <span style={{ fontSize: 11, color: '#555', flexShrink: 0 }}>Loading…</span>
        )}

        {/* Device switcher */}
        {[{ name: 'Desktop', icon: '🖥' }, { name: 'Tablet', icon: '📱' }, { name: 'Mobile', icon: '📲' }].map(d => (
          <button
            key={d.name}
            onClick={() => handleDevice(d.name)}
            title={d.name}
            style={{ padding: '4px 7px', borderRadius: 6, fontSize: 13, background: 'transparent', color: '#666', border: '1px solid #2a2a2a', cursor: 'pointer', flexShrink: 0 }}
          >
            {d.icon}
          </button>
        ))}

        <div style={{ width: 1, height: 20, background: lightTheme ? '#d2d2d7' : '#2a2a2a', flexShrink: 0 }} />

        {/* Reset */}
        <button
          onClick={handleReset}
          disabled={!savedPages[activePage?.key ?? '']}
          style={{
            padding: '4px 10px', borderRadius: 9999, fontSize: 11, flexShrink: 0,
            background: 'transparent', color: savedPages[activePage?.key ?? ''] ? '#f87171' : '#333',
            border: `1px solid ${savedPages[activePage?.key ?? ''] ? '#7f1d1d' : '#2a2a2a'}`,
            cursor: savedPages[activePage?.key ?? ''] ? 'pointer' : 'default',
          }}
        >
          Reset
        </button>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={status !== 'ready'}
          style={{
            padding: '4px 14px', borderRadius: 9999, fontSize: 12, fontWeight: 600, flexShrink: 0,
            background: saved ? '#16a34a' : '#0066cc', color: '#fff', border: 'none',
            cursor: status === 'ready' ? 'pointer' : 'not-allowed',
            opacity: status === 'ready' ? 1 : 0.4, transition: 'background 0.3s',
          }}
        >
          {saveLabel}
        </button>

        {/* CMS */}
        <button
          onClick={() => { setCmsOpen(o => !o); setCmsView('list'); setActiveCol(null); }}
          style={{
            padding: '0 14px', height: 28, borderRadius: 9999, fontSize: 12, fontWeight: 600,
            background: cmsOpen ? '#7c3aed' : 'transparent', color: cmsOpen ? '#fff' : (lightTheme ? '#555' : '#888'),
            border: `1px solid ${lightTheme ? '#c7c7cc' : '#444'}`, cursor: 'pointer',
          }}
        >
          ⊞ CMS
        </button>

        {/* Preview in new tab */}
        <button
          onClick={() => {
            if (!activePage || !siteId) return;
            // Save current state first, then open
            const editor = editorRef.current;
            if (editor && status === 'ready') {
              fetch('/api/save-page', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteId, pageKey: activePage.key, pageLabel: activePage.label, html: editor.getHtml(), css: editor.getCss() ?? '' }),
              }).then(() => window.open(`/sites/${siteId}/${activePage.key}.html`, '_blank'));
            }
          }}
          disabled={status !== 'ready'}
          style={{
            padding: '0 14px', height: 28, borderRadius: 9999, fontSize: 12, fontWeight: 600,
            background: 'transparent', color: lightTheme ? '#555' : '#888', border: `1px solid ${lightTheme ? '#c7c7cc' : '#444'}`,
            cursor: status === 'ready' ? 'pointer' : 'not-allowed', opacity: status === 'ready' ? 1 : 0.4,
          }}
        >
          ↗ Preview
        </button>

        {/* Deploy */}
        <button
          onClick={() => { setDeployOpen(true); setDeployStatus('idle'); setDeployError(null); setDeployUrl(null); }}
          disabled={status !== 'ready'}
          style={{
            padding: '0 14px', height: 28, borderRadius: 9999, fontSize: 12, fontWeight: 600,
            background: '#16a34a', color: '#fff', border: 'none',
            cursor: status === 'ready' ? 'pointer' : 'not-allowed', opacity: status === 'ready' ? 1 : 0.4,
          }}
        >
          ↑ Deploy
        </button>

        {/* Export */}
        <button
          onClick={handleExport}
          disabled={status !== 'ready'}
          style={{
            padding: '4px 10px', borderRadius: 9999, fontSize: 11, flexShrink: 0,
            background: 'transparent', color: lightTheme ? '#555' : '#888', border: `1px solid ${lightTheme ? '#c7c7cc' : '#2a2a2a'}`,
            cursor: status === 'ready' ? 'pointer' : 'default',
            opacity: status === 'ready' ? 1 : 0.4,
          }}
        >
          Export ↓
        </button>

        <div style={{ width: 1, height: 20, background: lightTheme ? '#d2d2d7' : '#2a2a2a', flexShrink: 0 }} />

        {/* Nav open/closed toggle */}
        <button
          onClick={() => setNavForceOpen(o => !o)}
          disabled={status !== 'ready'}
          title={navForceOpen ? 'Click to preview nav CLOSED' : 'Click to preview nav OPEN — lets you visually edit nav links'}
          style={{
            padding: '4px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600, flexShrink: 0,
            background: navForceOpen ? '#0c4a6e' : 'transparent',
            color: navForceOpen ? '#7dd3fc' : (lightTheme ? '#555' : '#888'),
            border: `1px solid ${navForceOpen ? '#0369a1' : (lightTheme ? '#c7c7cc' : '#444')}`,
            cursor: status === 'ready' ? 'pointer' : 'not-allowed', opacity: status === 'ready' ? 1 : 0.4,
          }}
        >
          {navForceOpen ? '☰ Nav: Open' : '☰ Nav: Closed'}
        </button>

        {/* Code editor */}
        <button
          onClick={openCodeEditor}
          disabled={status !== 'ready'}
          title="Edit HTML + CSS directly"
          style={{
            padding: '4px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600, flexShrink: 0,
            background: codeEditorOpen ? '#1c1917' : 'transparent',
            color: codeEditorOpen ? '#fbbf24' : (lightTheme ? '#555' : '#888'),
            border: `1px solid ${codeEditorOpen ? '#78350f' : (lightTheme ? '#c7c7cc' : '#444')}`,
            cursor: status === 'ready' ? 'pointer' : 'not-allowed', opacity: status === 'ready' ? 1 : 0.4,
          }}
        >
          {'</>'}  Code
        </button>

        {/* Make Responsive shortcut */}
        <button
          onClick={() => sendQuickPrompt('Make this page fully responsive — fix the layout for mobile, tablet, and desktop. Use CSS-only hamburger for the navbar.')}
          disabled={status !== 'ready' || chatLoading}
          title="Ask Claude to make the page responsive"
          style={{
            padding: '4px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600, flexShrink: 0,
            background: 'transparent', color: '#a78bfa',
            border: '1px solid #4c1d95', cursor: status === 'ready' && !chatLoading ? 'pointer' : 'not-allowed',
            opacity: status === 'ready' && !chatLoading ? 1 : 0.4,
          }}
        >
          ⊡ Responsive
        </button>

        {/* Claude */}
        <button
          onClick={() => setChatOpen(o => !o)}
          style={{
            padding: '4px 12px', borderRadius: 9999, fontSize: 11, fontWeight: 600, flexShrink: 0,
            background: chatOpen ? '#4c1d95' : 'transparent',
            color: chatOpen ? '#e9d5ff' : '#a78bfa',
            border: '1px solid #4c1d95', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          ✦ Claude{selectedLabel ? ` · ${selectedLabel}` : ''}
        </button>

        <div style={{ width: 1, height: 20, background: lightTheme ? '#d2d2d7' : '#2a2a2a', flexShrink: 0 }} />

        {/* Undo / Redo */}
        <button onClick={handleUndo} title="Undo (⌘Z)"   style={{ padding: '3px 7px', borderRadius: 6, fontSize: 13, background: 'transparent', color: lightTheme ? '#555' : '#666', border: `1px solid ${lightTheme ? '#c7c7cc' : '#2a2a2a'}`, cursor: 'pointer', flexShrink: 0 }}>↩</button>
        <button onClick={handleRedo} title="Redo (⌘⇧Z)"  style={{ padding: '3px 7px', borderRadius: 6, fontSize: 13, background: 'transparent', color: lightTheme ? '#555' : '#666', border: `1px solid ${lightTheme ? '#c7c7cc' : '#2a2a2a'}`, cursor: 'pointer', flexShrink: 0 }}>↪</button>

        {/* History */}
        <button
          onClick={() => setHistoryOpen(o => !o)}
          style={{
            padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600, flexShrink: 0,
            background: historyOpen ? '#292524' : 'transparent',
            color: historyOpen ? '#fbbf24' : (lightTheme ? '#555' : '#666'),
            border: `1px solid ${historyOpen ? '#78350f' : (lightTheme ? '#c7c7cc' : '#2a2a2a')}`, cursor: 'pointer',
          }}
        >
          🕐 {snapshots.length > 0 ? snapshots.length : ''}
        </button>

        {/* Light / Dark theme toggle */}
        <button
          onClick={() => setLightTheme(t => !t)}
          title={lightTheme ? 'Switch to dark UI' : 'Switch to light UI'}
          style={{
            padding: '3px 9px', borderRadius: 6, fontSize: 13, flexShrink: 0,
            background: 'transparent', color: lightTheme ? '#f59e0b' : '#666',
            border: `1px solid ${lightTheme ? '#f59e0b' : '#2a2a2a'}`, cursor: 'pointer',
          }}
        >
          {lightTheme ? '☀︎' : '◑'}
        </button>
      </div>

      {/* ── GrapesJS canvas ── */}
      <div ref={mountRef} style={{ flex: 1, overflow: 'hidden', position: 'relative' }} />

      {/* ── Loading overlay ── */}
      {status === 'loading' && (
        <div style={{ position: 'absolute', inset: 0, top: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', zIndex: 1, pointerEvents: 'none' }}>
          <div style={{ background: '#1e1e1e', borderRadius: 12, padding: '20px 28px', border: '1px solid #333' }}>
            <span style={{ color: '#888', fontSize: 13 }}>Capturing page from URL…</span>
          </div>
        </div>
      )}

      {/* ── History panel (left) ── */}
      {historyOpen && (
        <div style={{ position: 'absolute', left: 0, top: 48, bottom: 0, width: 280, background: '#111', borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', zIndex: 20 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ color: '#fbbf24', fontSize: 13, fontWeight: 600 }}>🕐 Change History</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {snapshots.length > 0 && (
                <button onClick={handleClearHistory} style={{ fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear all</button>
              )}
              <button onClick={() => setHistoryOpen(false)} style={{ color: '#555', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
          </div>
          <div style={{ padding: '6px 14px', borderBottom: '1px solid #2a2a2a', fontSize: 10, color: '#555', flexShrink: 0 }}>
            {activePage?.label} · auto-saved 3 s after each change
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {snapshots.length === 0 ? (
              <div style={{ padding: '16px 14px', color: '#444', fontSize: 11, lineHeight: 1.7 }}>
                <p>No snapshots yet.</p>
                <p style={{ marginTop: 6 }}>Snapshots are captured automatically 3 seconds after you make a change.</p>
              </div>
            ) : snapshots.map((snap, i) => (
              <div key={snap.ts} style={{ padding: '9px 14px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: i === 0 ? '#fbbf24' : '#888', fontWeight: i === 0 ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {snap.label}{i === 0 ? ' · latest' : ''}
                  </div>
                  <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{formatTs(snap.ts)}</div>
                </div>
                <button onClick={() => handleRestoreSnapshot(snap)} style={{ padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: 'transparent', color: '#888', border: '1px solid #333', cursor: 'pointer', flexShrink: 0 }}>
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Code editor panel (right side) ── */}
      {codeEditorOpen && (
        <div style={{ position: 'absolute', right: 0, top: 48, bottom: 0, width: 480, background: '#0d0d0d', borderLeft: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', zIndex: 25 }}>
          {/* Header */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#fbbf24', fontSize: 13, fontWeight: 600 }}>{'</>'}  Code Editor</span>
              <span style={{ fontSize: 10, color: '#555' }}>{activePage?.label}</span>
            </div>
            <button onClick={() => setCodeEditorOpen(false)} style={{ color: '#555', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #2a2a2a', flexShrink: 0 }}>
            {(['html', 'css'] as const).map(tab => (
              <button key={tab} onClick={() => setCodeTab(tab)} style={{
                flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600, background: 'none', border: 'none',
                borderBottom: codeTab === tab ? '2px solid #fbbf24' : '2px solid transparent',
                color: codeTab === tab ? '#fbbf24' : '#555', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>{tab}</button>
            ))}
          </div>

          {/* Textarea */}
          <textarea
            key={codeTab}
            value={codeTab === 'html' ? codeHtml : codeCss}
            onChange={e => codeTab === 'html' ? setCodeHtml(e.target.value) : setCodeCss(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1, resize: 'none', background: '#0d0d0d', color: '#d4d4d4',
              border: 'none', outline: 'none', padding: '14px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6,
              whiteSpace: 'pre', overflowX: 'auto',
            }}
          />

          {/* Footer */}
          <div style={{ padding: '10px 14px', borderTop: '1px solid #2a2a2a', display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={applyCodeEditorChanges}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 700, background: '#fbbf24', color: '#000', border: 'none', cursor: 'pointer' }}
            >
              ✓ Apply to canvas
            </button>
            <button
              onClick={() => { const e = editorRef.current; if (e) { setCodeHtml(e.getHtml()); setCodeCss(e.getCss() ?? ''); } }}
              style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, background: 'transparent', color: '#666', border: '1px solid #333', cursor: 'pointer' }}
              title="Discard edits and reload from canvas"
            >
              ↺ Reset
            </button>
          </div>
        </div>
      )}

      {/* ── CMS panel (left side) ── */}
      {cmsOpen && (
        <div style={{ position: 'absolute', left: 0, top: 48, bottom: 0, width: cmsView === 'table' ? 480 : 360, background: '#111', borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', zIndex: 20, overflowY: 'auto' }}>

          {/* Header */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {cmsView !== 'list' && (
                <button onClick={() => { setCmsView(cmsView === 'schema' ? 'table' : 'list'); }}
                  style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, marginRight: 2 }}>←</button>
              )}
              <span style={{ color: '#7c3aed', fontSize: 13, fontWeight: 700 }}>⊞ CMS</span>
              {activeCol && cmsView !== 'list' && (
                <span style={{ color: '#555', fontSize: 11 }}>/ {cmsData.collections[activeCol]?.label}</span>
              )}
              {cmsView === 'schema' && <span style={{ color: '#555', fontSize: 11 }}>/ Schema</span>}
            </div>
            <button onClick={() => setCmsOpen(false)} style={{ color: '#555', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
          </div>

          {/* ── Collections list ── */}
          {cmsView === 'list' && (
            <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Object.keys(cmsData.collections).length === 0 && (
                <p style={{ color: '#444', fontSize: 12, lineHeight: 1.6 }}>No collections yet. Create one to start managing content on this site.</p>
              )}
              {Object.entries(cmsData.collections).map(([key, col]) => (
                <div key={key} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <p style={{ color: '#ccc', fontSize: 13, fontWeight: 600 }}>{col.label}</p>
                    <p style={{ color: '#555', fontSize: 11, marginTop: 2 }}>{col.records.length} record{col.records.length !== 1 ? 's' : ''} · {col.fields.length} field{col.fields.length !== 1 ? 's' : ''}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => { setActiveCol(key); setCmsView('table'); }} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer' }}>Open</button>
                    <button onClick={() => cmsDeleteCollection(key)} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'transparent', color: '#555', border: '1px solid #333', cursor: 'pointer' }}>✕</button>
                  </div>
                </div>
              ))}

              {/* New collection form */}
              <div style={{ background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 10, padding: 14, marginTop: 8 }}>
                <p style={{ color: '#666', fontSize: 11, fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>New Collection</p>
                <input
                  value={newColName} onChange={e => setNewColName(e.target.value)}
                  placeholder="Collection name (e.g. Blog Posts)"
                  style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '7px 10px', color: '#ccc', fontSize: 12, outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
                />
                <p style={{ color: '#555', fontSize: 11, marginBottom: 6 }}>Fields</p>
                {newColFields.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                    <input value={f.label} onChange={e => setNewColFields(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value, key: cmsSlug(e.target.value) || x.key } : x))}
                      placeholder="Field label" style={{ flex: 1, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '5px 8px', color: '#ccc', fontSize: 11, outline: 'none' }} />
                    <select value={f.type} onChange={e => setNewColFields(prev => prev.map((x, j) => j === i ? { ...x, type: e.target.value as CmsFieldType } : x))}
                      style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '5px 6px', color: '#888', fontSize: 10, outline: 'none' }}>
                      {(['text','textarea','number','date','url','image-url'] as CmsFieldType[]).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {newColFields.length > 1 && (
                      <button onClick={() => setNewColFields(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                    )}
                  </div>
                ))}
                <button onClick={() => setNewColFields(prev => [...prev, { key: `field${prev.length+1}`, label: `Field ${prev.length+1}`, type: 'text' }])}
                  style={{ fontSize: 11, color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 10 }}>+ Add field</button>
                <button onClick={cmsCreateCollection} disabled={!newColName.trim()}
                  style={{ width: '100%', background: newColName.trim() ? '#7c3aed' : '#1a1a2e', color: newColName.trim() ? '#fff' : '#444', border: 'none', borderRadius: 9999, padding: '8px 0', fontSize: 12, fontWeight: 600, cursor: newColName.trim() ? 'pointer' : 'not-allowed' }}>
                  Create Collection
                </button>
              </div>
            </div>
          )}

          {/* ── Table view (Supabase-style) ── */}
          {cmsView === 'table' && activeCol && cmsData.collections[activeCol] && (() => {
            const col = cmsData.collections[activeCol];
            const cellStyle: React.CSSProperties = { padding: '0 8px', height: 36, borderRight: '1px solid #1e1e1e', display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden', flexShrink: 0 };
            const COL_W = 130;
            return (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Toolbar */}
                <div style={{ padding: '8px 12px', borderBottom: '1px solid #2a2a2a', display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                  <button onClick={() => cmsAddRecord(activeCol)}
                    style={{ padding: '5px 12px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 9999, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>+ Row</button>
                  <button onClick={() => { setSchemaFields(col.fields); setCmsView('schema'); }}
                    style={{ padding: '5px 12px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: 9999, fontSize: 11, cursor: 'pointer' }}>⚙ Schema</button>
                  <button onClick={() => setCmsSnippetCol(cmsSnippetCol === activeCol ? null : activeCol)}
                    style={{ padding: '5px 12px', background: 'transparent', color: '#7c3aed', border: '1px solid #7c3aed', borderRadius: 9999, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{'</>'} Insert</button>
                </div>

                {/* Snippet layout picker */}
                {cmsSnippetCol === activeCol && (
                  <div style={{ padding: '10px 12px', background: '#0a0a1a', borderBottom: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Layout</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                      {(['grid','list','cards','table'] as const).map(lay => (
                        <button key={lay} onClick={() => setCmsInsertLayout(lay)}
                          style={{ padding: '5px 4px', fontSize: 11, borderRadius: 7, border: `1px solid ${cmsInsertLayout === lay ? '#7c3aed' : '#2a2a2a'}`, background: cmsInsertLayout === lay ? '#2d1b69' : '#111', color: cmsInsertLayout === lay ? '#c4b5fd' : '#666', cursor: 'pointer', fontWeight: 600 }}>
                          {lay === 'grid' ? '▦ Grid' : lay === 'list' ? '☰ List' : lay === 'cards' ? '▬ Cards' : '⊟ Table'}
                        </button>
                      ))}
                    </div>
                    <button onClick={() => cmsInsertSnippet(activeCol, cmsInsertLayout)}
                      style={{ width: '100%', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 9999, padding: '6px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      ↳ Insert into page
                    </button>
                  </div>
                )}

                {/* Table header */}
                <div style={{ display: 'flex', background: '#161616', borderBottom: '2px solid #2a2a2a', flexShrink: 0, overflowX: 'auto' }}>
                  <div style={{ ...cellStyle, width: 28, minWidth: 28 }} />
                  {col.fields.map(f => (
                    <div key={f.key} style={{ ...cellStyle, width: COL_W, fontWeight: 700, color: '#888', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</span>
                      <span style={{ color: '#333', marginLeft: 4, fontSize: 9 }}>{f.type}</span>
                    </div>
                  ))}
                  <div style={{ ...cellStyle, width: 28, minWidth: 28 }} />
                </div>

                {/* Rows */}
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
                  {col.records.length === 0 && (
                    <div style={{ padding: '20px 16px', color: '#444', fontSize: 12 }}>No records yet. Click + Row to add one.</div>
                  )}
                  {col.records.map((record, idx) => (
                    <div key={record.id} style={{ display: 'flex', borderBottom: '1px solid #1a1a1a', background: '#111' }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#161616'}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = '#111'}>
                      {/* Row handle */}
                      <div style={{ ...cellStyle, width: 28, minWidth: 28, flexDirection: 'column', gap: 0, cursor: 'pointer' }}>
                        <button onClick={() => cmsReorderRecord(activeCol, record.id, -1)} disabled={idx === 0}
                          style={{ background: 'none', border: 'none', color: idx === 0 ? '#2a2a2a' : '#555', cursor: idx === 0 ? 'default' : 'pointer', fontSize: 8, padding: 0, lineHeight: 1 }}>▲</button>
                        <button onClick={() => cmsReorderRecord(activeCol, record.id, 1)} disabled={idx === col.records.length - 1}
                          style={{ background: 'none', border: 'none', color: idx === col.records.length - 1 ? '#2a2a2a' : '#555', cursor: idx === col.records.length - 1 ? 'default' : 'pointer', fontSize: 8, padding: 0, lineHeight: 1 }}>▼</button>
                      </div>
                      {/* Cells */}
                      {col.fields.map(field => {
                        const isEditing = editingCell?.rid === record.id && editingCell?.fkey === field.key;
                        const val = record[field.key] ?? '';
                        return (
                          <div key={field.key} style={{ ...cellStyle, width: COL_W, flexShrink: 0, cursor: 'pointer', position: 'relative' }}
                            onClick={() => {
                              if (field.type === 'textarea') {
                                setRecordModal(record);
                                setModalDraft({ ...record });
                                setActiveTab(field.key);
                                setMdPreview(false);
                              } else if (field.type === 'image-url') {
                                setRecordModal(record);
                                setModalDraft({ ...record });
                                setActiveTab(field.key);
                              } else {
                                setEditingCell({ rid: record.id, fkey: field.key });
                                setCellDraft(val);
                              }
                            }}>
                            {isEditing ? (
                              <input autoFocus value={cellDraft}
                                onChange={e => setCellDraft(e.target.value)}
                                onBlur={async () => {
                                  await updateCellValue(activeCol, record.id, field.key, cellDraft);
                                  setEditingCell(null);
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  if (e.key === 'Escape') setEditingCell(null);
                                }}
                                style={{ width: '100%', background: 'transparent', border: 'none', outline: '1px solid #7c3aed', borderRadius: 3, padding: '2px 4px', color: '#ddd', fontSize: 12 }}
                              />
                            ) : field.type === 'image-url' ? (
                              val
                                ? <img src={val} alt="" style={{ height: 28, width: 44, objectFit: 'cover', borderRadius: 4 }} />
                                : <span style={{ color: '#333', fontSize: 11 }}>—</span>
                            ) : field.type === 'textarea' ? (
                              <span style={{ color: val ? '#9ca3af' : '#333', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', width: '100%' }}>
                                {val ? '✏ ' + val.slice(0, 30) + (val.length > 30 ? '…' : '') : '✏ click to edit'}
                              </span>
                            ) : (
                              <span style={{ color: val ? '#ddd' : '#333', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', width: '100%' }}>
                                {val || '—'}
                              </span>
                            )}
                          </div>
                        );
                      })}
                      {/* Open full editor + delete */}
                      <div style={{ ...cellStyle, width: 28, minWidth: 28, gap: 4, flexShrink: 0 }}>
                        <button onClick={() => { setRecordModal(record); setModalDraft({ ...record }); setActiveTab(col.fields[0]?.key ?? ''); setMdPreview(false); }}
                          title="Open record" style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 11, padding: 0 }}>↗</button>
                        <button onClick={() => cmsDeleteRecord(activeCol, record.id)}
                          title="Delete" style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
                      </div>
                    </div>
                  ))}
                  {/* Add row button inline */}
                  <button onClick={() => cmsAddRecord(activeCol)}
                    style={{ width: '100%', padding: '8px 16px', background: 'transparent', border: 'none', borderTop: '1px solid #1a1a1a', color: '#444', fontSize: 11, cursor: 'pointer', textAlign: 'left' }}>
                    + Add row
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ── Schema editor ── */}
          {cmsView === 'schema' && activeCol && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ color: '#666', fontSize: 11, marginBottom: 4 }}>Edit fields for <strong style={{ color: '#ccc' }}>{cmsData.collections[activeCol]?.label}</strong></p>
              {schemaFields.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input value={f.label}
                    onChange={e => setSchemaFields(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value, key: cmsSlug(e.target.value) || x.key } : x))}
                    placeholder="Field label"
                    style={{ flex: 1, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 8px', color: '#ccc', fontSize: 12, outline: 'none' }} />
                  <select value={f.type}
                    onChange={e => setSchemaFields(prev => prev.map((x, j) => j === i ? { ...x, type: e.target.value as CmsFieldType } : x))}
                    style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 6px', color: '#888', fontSize: 11, outline: 'none' }}>
                    {(['text','textarea','number','date','url','image-url'] as CmsFieldType[]).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button onClick={() => setSchemaFields(prev => prev.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: 0 }}>×</button>
                </div>
              ))}
              <button onClick={() => setSchemaFields(prev => [...prev, { key: `field${prev.length+1}`, label: `Field ${prev.length+1}`, type: 'text' }])}
                style={{ fontSize: 12, color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>+ Add field</button>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => cmsSaveSchema(activeCol)}
                  style={{ flex: 1, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 9999, padding: '8px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Save schema</button>
                <button onClick={() => setCmsView('table')}
                  style={{ padding: '8px 14px', background: 'transparent', color: '#666', border: '1px solid #333', borderRadius: 9999, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Record modal — split editor / preview ── */}
      {recordModal && activeCol && cmsData.collections[activeCol] && (() => {
        const col = cmsData.collections[activeCol];
        const imageField  = col.fields.find(f => f.type === 'image-url');
        const titleField  = col.fields.find(f => f.type !== 'image-url');
        const bodyFields  = col.fields.filter(f => f.type === 'textarea');
        const metaFields  = col.fields.filter(f => f.type !== 'textarea' && f.type !== 'image-url' && f !== titleField);

        const insertMd = (fkey: string, syntax: string, wrap = false) => {
          const ta = document.getElementById('md-editor-' + fkey) as HTMLTextAreaElement | null;
          if (!ta) { setModalDraft(prev => ({ ...prev, [fkey]: (prev[fkey] ?? '') + syntax })); return; }
          const s = ta.selectionStart, e = ta.selectionEnd;
          const sel = ta.value.slice(s, e);
          const replacement = wrap ? syntax + sel + syntax : syntax + sel;
          const newVal = ta.value.slice(0, s) + replacement + ta.value.slice(e);
          setModalDraft(prev => ({ ...prev, [fkey]: newVal }));
          setTimeout(() => { ta.focus(); ta.setSelectionRange(s + syntax.length, s + syntax.length + sel.length); }, 0);
        };

        return (
          <div style={{ position: 'absolute', inset: 0, top: 48, zIndex: 40, display: 'flex', flexDirection: 'column', background: '#0d0d0d' }}>

            {/* Header */}
            <div style={{ borderBottom: '1px solid #2a2a2a', padding: '9px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#7c3aed', fontSize: 12, fontWeight: 700 }}>⊞ {col.label}</span>
                <span style={{ color: '#444', fontSize: 11 }}>/ {modalDraft[titleField?.key ?? ''] || 'New record'}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={async () => { await cmsSaveModalRecord(activeCol); }}
                  style={{ padding: '5px 16px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 9999, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Save</button>
                <button onClick={() => setRecordModal(null)}
                  style={{ padding: '5px 12px', background: 'transparent', color: '#666', border: '1px solid #333', borderRadius: 9999, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>

            {/* Split body */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

              {/* ── LEFT: editor ── */}
              <div style={{ flex: 1, overflowY: 'auto', borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column' }}>

                {/* Cover image — always available, stored as _cover */}
                <div style={{ position: 'relative', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
                  {modalDraft._cover ? (
                    <>
                      <img src={modalDraft._cover} alt="" style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }} />
                      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
                        <label style={{ cursor: 'pointer' }}>
                          <span style={{ padding: '4px 10px', background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>Change</span>
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                            const file = e.target.files?.[0]; if (!file) return;
                            const reader = new FileReader();
                            reader.onload = async ev => { const c = await compressImage(ev.target?.result as string); setModalDraft(prev => ({ ...prev, _cover: c })); };
                            reader.readAsDataURL(file);
                          }} />
                        </label>
                        <button onClick={() => setModalDraft(prev => ({ ...prev, _cover: '' }))}
                          style={{ padding: '4px 10px', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
                      </div>
                    </>
                  ) : (
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 48, cursor: 'pointer', color: '#444', fontSize: 12, gap: 6 }}>
                      <span>🖼 Add cover image</span>
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                        const file = e.target.files?.[0]; if (!file) return;
                        const reader = new FileReader();
                        reader.onload = async ev => { const c = await compressImage(ev.target?.result as string); setModalDraft(prev => ({ ...prev, _cover: c })); };
                        reader.readAsDataURL(file);
                      }} />
                    </label>
                  )}
                </div>

                {/* Title field */}
                {titleField && (
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid #1a1a1a' }}>
                    <label style={{ fontSize: 10, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>{titleField.label}</label>
                    <input type={titleField.type === 'number' ? 'number' : titleField.type === 'date' ? 'date' : 'text'}
                      value={modalDraft[titleField.key] ?? ''}
                      onChange={e => setModalDraft(prev => ({ ...prev, [titleField.key]: e.target.value }))}
                      placeholder={titleField.type === 'url' ? 'https://...' : 'Untitled'}
                      style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', padding: 0, color: '#eee', fontSize: 22, fontWeight: 700, boxSizing: 'border-box' }} />
                  </div>
                )}

                {/* Meta fields */}
                {metaFields.length > 0 && (
                  <div style={{ padding: '10px 20px', borderBottom: '1px solid #1a1a1a', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    {metaFields.map(f => (
                      <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <label style={{ fontSize: 9, color: '#444', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</label>
                        <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                          value={modalDraft[f.key] ?? ''}
                          onChange={e => setModalDraft(prev => ({ ...prev, [f.key]: e.target.value }))}
                          placeholder={f.type === 'url' ? 'https://...' : '—'}
                          style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 5, padding: '4px 8px', color: '#ccc', fontSize: 12, outline: 'none', width: 120 }} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Textarea/body fields */}
                {bodyFields.map(field => (
                  <div key={field.key} style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid #1a1a1a', flex: bodyFields.length === 1 ? 1 : undefined }}>
                    {/* Markdown toolbar */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '5px 10px', background: '#111', borderBottom: '1px solid #1a1a1a', flexWrap: 'wrap', flexShrink: 0 }}>
                      <span style={{ color: '#444', fontSize: 10, fontWeight: 600, marginRight: 4 }}>{field.label}</span>
                      {([['B','**',true],['I','*',true],['H1','\n# ',false],['H2','\n## ',false],['H3','\n### ',false],['—','\n---\n',false],['• ','\n- ',false],['1. ','\n1. ',false]] as [string,string,boolean][]).map(([lbl,syn,wr]) => (
                        <button key={lbl} onMouseDown={e => { e.preventDefault(); insertMd(field.key, syn, wr); }}
                          style={{ padding: '2px 7px', fontSize: 11, fontWeight: lbl==='B'?700:lbl==='I'?400:600, fontStyle: lbl==='I'?'italic':'normal', background: '#1a1a1a', color: '#888', border: '1px solid #222', borderRadius: 4, cursor: 'pointer' }}>{lbl}</button>
                      ))}
                      {/* Image upload button — saves cursor, opens picker, inserts at cursor */}
                      <label style={{ cursor: 'pointer' }} onMouseDown={() => {
                        const ta = document.getElementById('md-editor-' + field.key) as HTMLTextAreaElement | null;
                        if (ta) mdCursorRef.current[field.key] = [ta.selectionStart, ta.selectionEnd];
                      }}>
                        <span style={{ padding: '2px 7px', fontSize: 11, background: '#1a1a1a', color: '#888', border: '1px solid #222', borderRadius: 4, display: 'inline-block', cursor: 'pointer' }}>🖼</span>
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                          const file = e.target.files?.[0]; if (!file) return;
                          e.target.value = '';
                          const reader = new FileReader();
                          reader.onload = async ev => {
                            const c = await compressImage(ev.target?.result as string);
                            const mdImg = `\n![${file.name}](${c})\n`;
                            const [s, end2] = mdCursorRef.current[field.key] ?? [999999, 999999];
                            setModalDraft(prev => {
                              const cur = prev[field.key] ?? '';
                              return { ...prev, [field.key]: cur.slice(0, s) + mdImg + cur.slice(end2) };
                            });
                          };
                          reader.readAsDataURL(file);
                        }} />
                      </label>
                      <button onMouseDown={e => { e.preventDefault(); insertMd(field.key, '[text](url)', false); }}
                        style={{ padding: '2px 7px', fontSize: 11, background: '#1a1a1a', color: '#888', border: '1px solid #222', borderRadius: 4, cursor: 'pointer' }}>🔗</button>
                    </div>
                    <textarea id={'md-editor-' + field.key}
                      value={modalDraft[field.key] ?? ''}
                      onChange={e => setModalDraft(prev => ({ ...prev, [field.key]: e.target.value }))}
                      onSelect={e => {
                        const ta = e.target as HTMLTextAreaElement;
                        mdCursorRef.current[field.key] = [ta.selectionStart, ta.selectionEnd];
                      }}
                      onPaste={async e => {
                        const items = Array.from(e.clipboardData.items);
                        const imgItem = items.find(it => it.type.startsWith('image/'));
                        if (!imgItem) return;
                        e.preventDefault();
                        const file = imgItem.getAsFile(); if (!file) return;
                        const ta = e.target as HTMLTextAreaElement;
                        const s = ta.selectionStart, en = ta.selectionEnd;
                        const reader = new FileReader();
                        reader.onload = async ev => {
                          const c = await compressImage(ev.target?.result as string);
                          const mdImg = `\n![pasted image](${c})\n`;
                          setModalDraft(prev => {
                            const cur = prev[field.key] ?? '';
                            return { ...prev, [field.key]: cur.slice(0, s) + mdImg + cur.slice(en) };
                          });
                        };
                        reader.readAsDataURL(file);
                      }}
                      placeholder={'Write in **markdown**...\n\n# H1  ## H2  **bold**  *italic*\n- list item\n\nPaste or drag an image to insert it.'}
                      style={{ flex: 1, minHeight: 220, background: '#0d0d0d', border: 'none', outline: 'none', padding: '14px 20px', color: '#ccc', fontSize: 14, lineHeight: 1.75, resize: 'none', fontFamily: '"Fira Code", "Cascadia Code", monospace' }} />
                  </div>
                ))}
              </div>

              {/* ── RIGHT: live preview ── */}
              <div style={{ flex: 1, overflowY: 'auto', background: '#fff' }}>
                {/* Cover */}
                {(modalDraft._cover || (imageField && modalDraft[imageField.key])) && (
                  <img src={modalDraft._cover || (imageField ? modalDraft[imageField.key] : '')} alt="" style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
                )}
                <div style={{ padding: '28px 32px', maxWidth: 640, margin: '0 auto' }}>
                  {/* Meta pills */}
                  {metaFields.filter(f => modalDraft[f.key]).length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                      {metaFields.filter(f => modalDraft[f.key]).map(f => (
                        <span key={f.key} style={{ fontSize: 11, color: '#86868b', background: '#f5f5f7', border: '1px solid #e5e5ea', borderRadius: 9999, padding: '3px 10px' }}>
                          {f.label}: {modalDraft[f.key]}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Title */}
                  {titleField && (
                    <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1d1d1f', margin: '0 0 20px', lineHeight: 1.2, letterSpacing: '-0.02em' }}>
                      {modalDraft[titleField.key] || <span style={{ color: '#aaa' }}>Untitled</span>}
                    </h1>
                  )}
                  {/* Body fields rendered */}
                  {bodyFields.map(f => (
                    <div key={f.key} style={{ marginBottom: 24 }}>
                      {bodyFields.length > 1 && <p style={{ fontSize: 10, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{f.label}</p>}
                      <div style={{ fontSize: 16, lineHeight: 1.75, color: '#1d1d1f' }}
                        dangerouslySetInnerHTML={{ __html: renderMd(modalDraft[f.key] ?? '') }} />
                    </div>
                  ))}
                  {bodyFields.length === 0 && titleField && !modalDraft[titleField.key] && (
                    <p style={{ color: '#ccc', fontSize: 14 }}>Start typing on the left to see your preview here.</p>
                  )}
                </div>
              </div>

            </div>
          </div>
        );
      })()}

      {/* ── Claude chat panel (right) ── */}
      {chatOpen && (
        <div style={{ position: 'absolute', right: 0, top: 48, bottom: 0, width: 340, background: '#111', borderLeft: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', zIndex: 20 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ color: '#a78bfa', fontSize: 13, fontWeight: 600 }}>✦ Ask Claude</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setShowKeyInput(s => !s)} style={{ fontSize: 10, color: apiKey ? '#4ade80' : '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                {apiKey ? '● key set' : '● no key'}
              </button>
              <button onClick={() => setChatOpen(false)} style={{ color: '#555', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
          </div>
          {showKeyInput && (
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a2a2a', background: '#0d0d0d', flexShrink: 0 }}>
              <p style={{ fontSize: 10, color: '#666', marginBottom: 6 }}>Anthropic API key — stored in this browser only</p>
              <input
                type="password" placeholder="sk-ant-api03-…" value={apiKey}
                onChange={e => { setApiKey(e.target.value); localStorage.setItem('claude-api-key', e.target.value); }}
                style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', color: '#ccc', fontSize: 11, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          )}
          {selectedLabel && (
            <div style={{ padding: '5px 14px', background: '#1a0a2e', borderBottom: '1px solid #2a2a2a', fontSize: 10, color: '#a78bfa', flexShrink: 0 }}>
              ↳ <strong>{selectedLabel}</strong> selected
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {chatMsgs.length === 0 && (
              <div style={{ color: '#444', fontSize: 11, lineHeight: 1.7 }}>
                <p style={{ color: '#666', marginBottom: 8 }}>Select an element on the canvas, then ask Claude to refine it.</p>
                <p>Try:<br />· "Rewrite this copy to sound more confident"<br />· "Make this section more minimal"<br />· "Improve the visual hierarchy here"</p>
              </div>
            )}
            {chatMsgs.map((msg, i) => {
              const isStreaming = chatLoading && i === chatMsgs.length - 1 && msg.role === 'assistant';
              return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {/* Attachment thumbnails for user messages */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    {msg.attachments.map((att, ai) => (
                      att.kind === 'image' && att.preview ? (
                        <img key={ai} src={att.preview} alt={att.name} style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 8, border: '1px solid #333' }} />
                      ) : (
                        <div key={ai} style={{ background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, padding: '5px 9px', fontSize: 10, color: '#888', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span>{att.kind === 'pdf' ? '📄' : '📝'}</span> {att.name}
                        </div>
                      )
                    ))}
                  </div>
                )}
                {(() => {
                  const hasCode = /```(html|css)/i.test(msg.content);
                  const displayText = msg.content.replace(/```(?:html|css)[\s\S]*?(?:```|$)/gi, '').trim();
                  const isCodeOnly = hasCode && !displayText;
                  return (
                    <>
                      {/* Show streaming indicator while assistant message is being written */}
                      {isStreaming ? (
                        <div style={{ padding: '8px 12px', borderRadius: '10px 10px 10px 3px', background: '#1e1e1e', color: '#ccc', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'flex', alignItems: 'center', gap: 8 }}>
                          {displayText || <span style={{ color: '#555' }}>Generating…</span>}
                        </div>
                      ) : (
                        <>
                          {(!isCodeOnly || msg.role === 'user') && (
                            <div style={{ padding: '8px 12px', borderRadius: msg.role === 'user' ? '10px 10px 3px 10px' : '10px 10px 10px 3px', background: msg.role === 'user' ? '#0066cc' : '#1e1e1e', color: msg.role === 'user' ? '#fff' : '#ccc', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {displayText || msg.content}
                            </div>
                          )}
                          {msg.role === 'assistant' && hasCode && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>✓ Applied</span>
                              <button
                                onClick={() => /```css/i.test(msg.content) ? applyClaudeCss(msg.content) : applyClaudeHtml(msg.content)}
                                style={{ padding: '3px 10px', borderRadius: 9999, fontSize: 10, fontWeight: 600, background: 'transparent', color: '#555', border: '1px solid #333', cursor: 'pointer' }}
                              >
                                Re-apply
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
              );
            })}
            {chatLoading && chatMsgs[chatMsgs.length - 1]?.role !== 'assistant' && (
              <div style={{ color: '#555', fontSize: 11 }}>Claude is thinking…</div>
            )}
            <div ref={chatEndRef} />
          </div>
          {/* Attachment preview strip */}
          {attachments.length > 0 && (
            <div style={{ padding: '8px 14px', borderTop: '1px solid #2a2a2a', display: 'flex', flexWrap: 'wrap', gap: 6, background: '#0d0d0d', flexShrink: 0 }}>
              {attachments.map((att, i) => (
                <div key={i} style={{ position: 'relative', display: 'inline-flex' }}>
                  {att.kind === 'image' && att.preview ? (
                    <img src={att.preview} alt={att.name} style={{ width: 56, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid #333' }} />
                  ) : (
                    <div style={{ background: '#1e1e1e', border: '1px solid #333', borderRadius: 6, padding: '5px 8px', fontSize: 10, color: '#888', display: 'flex', alignItems: 'center', gap: 4, maxWidth: 120 }}>
                      <span>{att.kind === 'pdf' ? '📄' : '📝'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</span>
                    </div>
                  )}
                  <button
                    onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: -5, right: -5, width: 16, height: 16, borderRadius: '50%', background: '#333', color: '#ccc', border: 'none', cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* Input row */}
          <div style={{ padding: '10px 14px', borderTop: '1px solid #2a2a2a', display: 'flex', gap: 8, flexShrink: 0, alignItems: 'flex-end' }}>
            {/* Hidden file input */}
            <input
              ref={fileInputRef} type="file" multiple
              accept="image/*,application/pdf,.txt,.md,.html,.css,.js,.ts,.tsx,.json,.csv"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            {/* Attachment button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!apiKey}
              title="Attach image, PDF, or text file"
              style={{ padding: '7px 8px', borderRadius: 8, fontSize: 14, background: 'transparent', color: attachments.length > 0 ? '#a78bfa' : '#555', border: '1px solid #333', cursor: apiKey ? 'pointer' : 'not-allowed', flexShrink: 0, lineHeight: 1 }}
            >
              📎
            </button>
            <textarea
              value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleClaudeChat(); } }}
              onPaste={handlePaste}
              placeholder={apiKey ? 'Ask Claude… paste or attach images (Enter to send)' : 'Set your API key first ↑'}
              disabled={!apiKey} rows={2}
              style={{ flex: 1, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, padding: '7px 10px', color: '#ccc', fontSize: 11, resize: 'none', outline: 'none', lineHeight: 1.5 }}
            />
            <button
              onClick={handleClaudeChat}
              disabled={chatLoading || (!chatInput.trim() && attachments.length === 0) || !apiKey}
              style={{ padding: '0 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: '#6d28d9', color: '#fff', border: 'none', cursor: chatLoading || (!chatInput.trim() && attachments.length === 0) || !apiKey ? 'not-allowed' : 'pointer', opacity: chatLoading || (!chatInput.trim() && attachments.length === 0) || !apiKey ? 0.4 : 1, alignSelf: 'stretch' }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* ── Add Page modal ── */}
      {addPageOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 16, padding: 28, width: 380 }}>
            <p style={{ color: '#fff', fontWeight: 600, fontSize: 15, marginBottom: 20 }}>Add Page</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 5 }}>Page name *</label>
                <input
                  autoFocus value={newPageName} onChange={e => setNewPageName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddPage(); if (e.key === 'Escape') setAddPageOpen(false); }}
                  placeholder="e.g. About, Services, Contact"
                  style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8, padding: '9px 12px', color: '#ccc', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 5 }}>Source URL <span style={{ color: '#444' }}>(optional — to capture HTML from a local dev server)</span></label>
                <input
                  value={newPageUrl} onChange={e => setNewPageUrl(e.target.value)}
                  placeholder="http://localhost:3000/about"
                  style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8, padding: '9px 12px', color: '#ccc', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleAddPage} disabled={!newPageName.trim()} style={{ flex: 1, background: '#0066cc', color: '#fff', border: 'none', borderRadius: 9999, padding: '9px 0', fontSize: 13, fontWeight: 600, cursor: newPageName.trim() ? 'pointer' : 'not-allowed', opacity: newPageName.trim() ? 1 : 0.4 }}>Add Page</button>
              <button onClick={() => { setAddPageOpen(false); setNewPageName(''); setNewPageUrl(''); }} style={{ background: 'transparent', color: '#666', border: '1px solid #333', borderRadius: 9999, padding: '9px 18px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Export modal ── */}
      {exportHtml && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 16, padding: 24, width: 620, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <p style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>Export — {activePage?.label}.html</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleDownloadExport} style={{ background: '#0066cc', color: '#fff', border: 'none', borderRadius: 9999, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Download ↓</button>
                <button onClick={() => { navigator.clipboard.writeText(exportHtml); }} style={{ background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: 9999, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>Copy</button>
                <button onClick={() => setExportHtml(null)} style={{ color: '#555', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
              </div>
            </div>
            <textarea
              readOnly value={exportHtml}
              style={{ flex: 1, background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: '12px 14px', color: '#999', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.6, resize: 'none', outline: 'none', overflowY: 'auto', minHeight: 300 }}
            />
          </div>
        </div>
      )}

      {/* ── Deploy modal ── */}
      {deployOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 16, padding: 28, width: 480 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <p style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>↑ Deploy to Vercel</p>
              <button onClick={() => setDeployOpen(false)} style={{ color: '#555', background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 5 }}>
                Vercel API Token — <span style={{ color: '#444' }}>from vercel.com/account/tokens</span>
              </label>
              <input
                type="password"
                value={vercelToken}
                onChange={e => { setVercelToken(e.target.value); localStorage.setItem('vercel-token', e.target.value); }}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8, padding: '9px 12px', color: '#ccc', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: '#555', lineHeight: 1.6 }}>
              <strong style={{ color: '#666' }}>Project name:</strong> <span style={{ color: '#888' }}>{(site?.name ?? siteId ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40)}</span><br/>
              <strong style={{ color: '#666' }}>Pages:</strong> <span style={{ color: '#888' }}>{site?.pages.map(p => p.label).join(', ')}</span><br/>
              <strong style={{ color: '#666' }}>Files:</strong> <span style={{ color: '#888' }}>HTML + CSS per page (separate files)</span>
            </div>

            {deployStatus === 'idle' && (
              <button
                onClick={handleDeploy}
                disabled={!vercelToken}
                style={{ width: '100%', background: vercelToken ? '#16a34a' : '#1a2a1a', color: vercelToken ? '#fff' : '#444', border: 'none', borderRadius: 9999, padding: '11px 0', fontSize: 13, fontWeight: 700, cursor: vercelToken ? 'pointer' : 'not-allowed' }}
              >
                Deploy all pages →
              </button>
            )}

            {(deployStatus === 'saving' || deployStatus === 'deploying') && (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <p style={{ color: '#888', fontSize: 13 }}>
                  {deployStatus === 'saving' ? '💾 Saving pages to disk…' : '🚀 Deploying to Vercel…'}
                </p>
              </div>
            )}

            {deployStatus === 'done' && deployUrl && (
              <div style={{ background: '#0d1f0d', border: '1px solid #16a34a', borderRadius: 10, padding: '14px 16px' }}>
                <p style={{ color: '#4ade80', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>✓ Deployed successfully!</p>
                <a href={deployUrl} target="_blank" rel="noreferrer" style={{ color: '#86efac', fontSize: 12, wordBreak: 'break-all' }}>{deployUrl}</a>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={() => navigator.clipboard.writeText(deployUrl)} style={{ background: 'transparent', color: '#4ade80', border: '1px solid #16a34a', borderRadius: 9999, padding: '5px 14px', fontSize: 11, cursor: 'pointer' }}>Copy URL</button>
                  <button onClick={() => { setDeployStatus('idle'); setDeployUrl(null); }} style={{ background: 'transparent', color: '#555', border: '1px solid #333', borderRadius: 9999, padding: '5px 14px', fontSize: 11, cursor: 'pointer' }}>Deploy again</button>
                </div>
              </div>
            )}

            {deployStatus === 'error' && (
              <div style={{ background: '#1f0d0d', border: '1px solid #dc2626', borderRadius: 10, padding: '12px 14px' }}>
                <p style={{ color: '#f87171', fontSize: 12 }}>✗ {deployError}</p>
                <button onClick={() => setDeployStatus('idle')} style={{ marginTop: 10, background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: 9999, padding: '5px 14px', fontSize: 11, cursor: 'pointer' }}>Try again</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Hidden capture iframe ── */}
      <iframe
        ref={captureRef} title="page-capture"
        style={{ position: 'absolute', top: -9999, left: -9999, width: 1440, height: 900, opacity: 0, pointerEvents: 'none' }}
      />
    </div>
  );
};
