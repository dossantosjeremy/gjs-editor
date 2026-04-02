import type { Site, SitePage, Snapshot } from './types';

const SITES_KEY    = 'gjs-sites';
const PAGE_PREFIX  = 'gjs-page:';
const HIST_PREFIX  = 'gjs-history:';

// ── Sites ─────────────────────────────────────────────────────────────────────

export function getSites(): Site[] {
  try { return JSON.parse(localStorage.getItem(SITES_KEY) ?? '[]'); }
  catch { return []; }
}

function saveSites(sites: Site[]) {
  localStorage.setItem(SITES_KEY, JSON.stringify(sites));
}

export function getSite(id: string): Site | null {
  return getSites().find(s => s.id === id) ?? null;
}

export function createSite(name: string, description?: string): Site {
  const site: Site = {
    id: crypto.randomUUID(),
    name: name.trim(),
    description: description?.trim(),
    pages: [{ key: 'home', label: 'Home' }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveSites([...getSites(), site]);
  return site;
}

export function updateSite(id: string, patch: Partial<Pick<Site, 'name' | 'description' | 'pages'>>) {
  const sites = getSites();
  const idx = sites.findIndex(s => s.id === id);
  if (idx === -1) return;
  sites[idx] = { ...sites[idx], ...patch, updatedAt: Date.now() };
  saveSites(sites);
}

export function deleteSite(id: string) {
  saveSites(getSites().filter(s => s.id !== id));
  // Remove all page content and history for this site
  Object.keys(localStorage)
    .filter(k => k.startsWith(PAGE_PREFIX + id + ':') || k.startsWith(HIST_PREFIX + id + ':'))
    .forEach(k => localStorage.removeItem(k));
}

// ── Pages within a site ───────────────────────────────────────────────────────

export function addPage(siteId: string, page: SitePage) {
  const site = getSite(siteId);
  if (!site) return;
  updateSite(siteId, { pages: [...site.pages, page] });
}

export function removePage(siteId: string, pageKey: string) {
  const site = getSite(siteId);
  if (!site) return;
  updateSite(siteId, { pages: site.pages.filter(p => p.key !== pageKey) });
  localStorage.removeItem(PAGE_PREFIX + siteId + ':' + pageKey);
  localStorage.removeItem(HIST_PREFIX + siteId + ':' + pageKey);
}

export function updatePages(siteId: string, pages: SitePage[]) {
  updateSite(siteId, { pages });
}

// ── Page content (HTML + CSS saved by the editor) ─────────────────────────────

export function getPageContent(siteId: string, pageKey: string): { html: string; css: string } | null {
  try {
    const raw = localStorage.getItem(PAGE_PREFIX + siteId + ':' + pageKey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function savePageContent(siteId: string, pageKey: string, html: string, css: string) {
  localStorage.setItem(PAGE_PREFIX + siteId + ':' + pageKey, JSON.stringify({ html, css }));
  updateSite(siteId, {}); // bump updatedAt
}

export function deletePageContent(siteId: string, pageKey: string) {
  localStorage.removeItem(PAGE_PREFIX + siteId + ':' + pageKey);
}

export function hasPageContent(siteId: string, pageKey: string): boolean {
  return localStorage.getItem(PAGE_PREFIX + siteId + ':' + pageKey) !== null;
}

// ── Page history (auto-snapshots) ─────────────────────────────────────────────

export function getPageHistory(siteId: string, pageKey: string): Snapshot[] {
  try {
    const raw = localStorage.getItem(HIST_PREFIX + siteId + ':' + pageKey);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function savePageHistory(siteId: string, pageKey: string, snapshots: Snapshot[]) {
  try { localStorage.setItem(HIST_PREFIX + siteId + ':' + pageKey, JSON.stringify(snapshots)); }
  catch { /* storage quota */ }
}

export function clearPageHistory(siteId: string, pageKey: string) {
  localStorage.removeItem(HIST_PREFIX + siteId + ':' + pageKey);
}
