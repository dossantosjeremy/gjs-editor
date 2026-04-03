/**
 * Unified async storage layer.
 * isRemote=true  → Supabase (all data scoped to auth.uid())
 * isRemote=false → localStorage (dev mode, same behaviour as before)
 */
import { supabase, isRemote } from './supabase';
import * as local from '../storage';
import type { Site, SitePage, Snapshot } from '../types';

// ── Auth user helper ──────────────────────────────────────────────────────────

async function uid(): Promise<string> {
  if (!supabase) return 'local';
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? 'local';
}

// ── CMS types ─────────────────────────────────────────────────────────────────

export type CmsFieldType = 'text' | 'textarea' | 'number' | 'date' | 'url' | 'image-url';
export type CmsField      = { key: string; label: string; type: CmsFieldType };
export type CmsRecord     = { id: string; [key: string]: string };
export type CmsCollection = {
  label: string;
  fields: CmsField[];
  records: CmsRecord[];
  /** HTML template for the collection list — uses {{fieldKey}} tokens */
  template?: string;
  /** HTML template for individual record pages — uses {{fieldKey}} tokens */
  recordTemplate?: string;
};
export type CmsData       = { collections: Record<string, CmsCollection> };

// ── Sites ─────────────────────────────────────────────────────────────────────

export async function getSites(): Promise<Site[]> {
  if (!isRemote || !supabase) return local.getSites();
  const userId = await uid();
  const { data } = await supabase.from('sites').select('*').eq('user_id', userId).order('updated_at', { ascending: false });
  return (data ?? []).map(row => ({
    id:          row.id,
    name:        row.name,
    description: row.description ?? undefined,
    pages:       row.pages ?? [],
    createdAt:   new Date(row.created_at).getTime(),
    updatedAt:   new Date(row.updated_at).getTime(),
  }));
}

export async function getSite(id: string): Promise<Site | null> {
  if (!isRemote || !supabase) return local.getSite(id);
  const userId = await uid();
  const { data } = await supabase.from('sites').select('*').eq('id', id).eq('user_id', userId).single();
  if (!data) return null;
  return {
    id:          data.id,
    name:        data.name,
    description: data.description ?? undefined,
    pages:       data.pages ?? [],
    createdAt:   new Date(data.created_at).getTime(),
    updatedAt:   new Date(data.updated_at).getTime(),
  };
}

export async function createSite(name: string, description?: string): Promise<Site> {
  if (!isRemote || !supabase) return local.createSite(name, description);
  const userId = await uid();
  const site: Site = {
    id:          crypto.randomUUID(),
    name:        name.trim(),
    description: description?.trim(),
    pages:       [{ key: 'home', label: 'Home' }],
    createdAt:   Date.now(),
    updatedAt:   Date.now(),
  };
  await supabase.from('sites').insert({
    id:          site.id,
    user_id:     userId,
    name:        site.name,
    description: site.description,
    pages:       site.pages,
  });
  return site;
}

export async function updateSite(id: string, patch: Partial<Pick<Site, 'name' | 'description' | 'pages'>>): Promise<void> {
  if (!isRemote || !supabase) { local.updateSite(id, patch); return; }
  const userId = await uid();
  await supabase.from('sites').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId);
}

export async function deleteSite(id: string): Promise<void> {
  if (!isRemote || !supabase) { local.deleteSite(id); return; }
  const userId = await uid();
  await Promise.all([
    supabase.from('sites').delete().eq('id', id).eq('user_id', userId),
    supabase.from('page_content').delete().eq('site_id', id).eq('user_id', userId),
    supabase.from('page_history').delete().eq('site_id', id).eq('user_id', userId),
    supabase.from('cms_collections').delete().eq('site_id', id).eq('user_id', userId),
    supabase.from('cms_records').delete().eq('site_id', id).eq('user_id', userId),
  ]);
}

// ── Pages within a site ───────────────────────────────────────────────────────

export async function addPage(siteId: string, page: SitePage): Promise<void> {
  if (!isRemote || !supabase) { local.addPage(siteId, page); return; }
  const site = await getSite(siteId);
  if (!site) return;
  await updateSite(siteId, { pages: [...site.pages, page] });
}

export async function removePage(siteId: string, pageKey: string): Promise<void> {
  if (!isRemote || !supabase) { local.removePage(siteId, pageKey); return; }
  const site = await getSite(siteId);
  if (!site) return;
  const userId = await uid();
  await Promise.all([
    updateSite(siteId, { pages: site.pages.filter(p => p.key !== pageKey) }),
    supabase.from('page_content').delete().eq('site_id', siteId).eq('page_key', pageKey).eq('user_id', userId),
    supabase.from('page_history').delete().eq('site_id', siteId).eq('page_key', pageKey).eq('user_id', userId),
  ]);
}

export async function updatePages(siteId: string, pages: SitePage[]): Promise<void> {
  if (!isRemote || !supabase) { local.updatePages(siteId, pages); return; }
  await updateSite(siteId, { pages });
}

// ── Page content ──────────────────────────────────────────────────────────────

export async function getPageContent(siteId: string, pageKey: string): Promise<{ html: string; css: string } | null> {
  if (!isRemote || !supabase) return local.getPageContent(siteId, pageKey);
  const userId = await uid();
  const { data } = await supabase.from('page_content').select('html,css').eq('site_id', siteId).eq('page_key', pageKey).eq('user_id', userId).single();
  return data ? { html: data.html, css: data.css } : null;
}

export async function savePageContent(siteId: string, pageKey: string, html: string, css: string): Promise<void> {
  if (!isRemote || !supabase) { local.savePageContent(siteId, pageKey, html, css); return; }
  const userId = await uid();
  await supabase.from('page_content').upsert({
    site_id: siteId, page_key: pageKey, user_id: userId, html, css,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'site_id,page_key,user_id' });
  await updateSite(siteId, {}); // bump updated_at
}

export async function deletePageContent(siteId: string, pageKey: string): Promise<void> {
  if (!isRemote || !supabase) { local.deletePageContent(siteId, pageKey); return; }
  const userId = await uid();
  await supabase.from('page_content').delete().eq('site_id', siteId).eq('page_key', pageKey).eq('user_id', userId);
}

export async function hasPageContent(siteId: string, pageKey: string): Promise<boolean> {
  if (!isRemote || !supabase) return local.hasPageContent(siteId, pageKey);
  const userId = await uid();
  const { count } = await supabase.from('page_content').select('*', { count: 'exact', head: true }).eq('site_id', siteId).eq('page_key', pageKey).eq('user_id', userId);
  return (count ?? 0) > 0;
}

// ── Page history ──────────────────────────────────────────────────────────────

export async function getPageHistory(siteId: string, pageKey: string): Promise<Snapshot[]> {
  if (!isRemote || !supabase) return local.getPageHistory(siteId, pageKey);
  const userId = await uid();
  const { data } = await supabase.from('page_history').select('snapshots').eq('site_id', siteId).eq('page_key', pageKey).eq('user_id', userId).single();
  return data?.snapshots ?? [];
}

export async function savePageHistory(siteId: string, pageKey: string, snapshots: Snapshot[]): Promise<void> {
  if (!isRemote || !supabase) { local.savePageHistory(siteId, pageKey, snapshots); return; }
  const userId = await uid();
  await supabase.from('page_history').upsert({
    site_id: siteId, page_key: pageKey, user_id: userId, snapshots,
  }, { onConflict: 'site_id,page_key,user_id' });
}

export async function clearPageHistory(siteId: string, pageKey: string): Promise<void> {
  if (!isRemote || !supabase) { local.clearPageHistory(siteId, pageKey); return; }
  const userId = await uid();
  await supabase.from('page_history').delete().eq('site_id', siteId).eq('page_key', pageKey).eq('user_id', userId);
}

// ── CMS ───────────────────────────────────────────────────────────────────────

export async function getCmsData(siteId: string): Promise<CmsData> {
  if (!isRemote || !supabase) {
    // Local: fetch from Vite dev-server middleware
    try {
      const res = await fetch(`/api/cms?siteId=${siteId}`);
      return await res.json();
    } catch {
      return { collections: {} };
    }
  }
  const userId = await uid();
  const [{ data: cols }, { data: recs }] = await Promise.all([
    supabase.from('cms_collections').select('*').eq('site_id', siteId).eq('user_id', userId),
    supabase.from('cms_records').select('*').eq('site_id', siteId).eq('user_id', userId),
  ]);
  const collections: Record<string, CmsCollection> = {};
  for (const col of cols ?? []) {
    collections[col.key] = {
      label:   col.label,
      fields:  col.fields ?? [],
      records: [],
    };
  }
  for (const rec of recs ?? []) {
    if (collections[rec.collection_key]) {
      collections[rec.collection_key].records.push({ id: rec.id, ...rec.data });
    }
  }
  return { collections };
}

export async function saveCmsData(siteId: string, cms: CmsData): Promise<void> {
  if (!isRemote || !supabase) {
    // Local: POST to Vite dev-server middleware
    await fetch('/api/cms', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ siteId, cms }),
    });
    return;
  }
  const userId = await uid();
  // Upsert each collection schema
  const colUpserts = Object.entries(cms.collections).map(([key, col]) => ({
    site_id: siteId, key, user_id: userId, label: col.label, fields: col.fields,
    updated_at: new Date().toISOString(),
  }));
  if (colUpserts.length > 0) {
    await supabase.from('cms_collections').upsert(colUpserts, { onConflict: 'site_id,key,user_id' });
  }
  // Delete collections that no longer exist
  const currentKeys = Object.keys(cms.collections);
  const { data: existingCols } = await supabase.from('cms_collections').select('key').eq('site_id', siteId).eq('user_id', userId);
  const toDelete = (existingCols ?? []).map(c => c.key).filter(k => !currentKeys.includes(k));
  if (toDelete.length > 0) {
    await supabase.from('cms_collections').delete().eq('site_id', siteId).eq('user_id', userId).in('key', toDelete);
    await supabase.from('cms_records').delete().eq('site_id', siteId).eq('user_id', userId).in('collection_key', toDelete);
  }
  // Upsert all records
  for (const [colKey, col] of Object.entries(cms.collections)) {
    const recUpserts = col.records.map(rec => {
      const { id, ...data } = rec;
      return { id, site_id: siteId, collection_key: colKey, user_id: userId, data, updated_at: new Date().toISOString() };
    });
    if (recUpserts.length > 0) {
      await supabase.from('cms_records').upsert(recUpserts, { onConflict: 'id,user_id' });
    }
    // Delete records that no longer exist in this collection
    const currentIds = col.records.map(r => r.id);
    const { data: existingRecs } = await supabase.from('cms_records').select('id').eq('site_id', siteId).eq('collection_key', colKey).eq('user_id', userId);
    const recsToDelete = (existingRecs ?? []).map(r => r.id).filter(id => !currentIds.includes(id));
    if (recsToDelete.length > 0) {
      await supabase.from('cms_records').delete().eq('user_id', userId).in('id', recsToDelete);
    }
  }
}
