import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSites, createSite, deleteSite, updateSite } from '../lib/db';
import { useAuth } from '../lib/auth';
import { isRemote } from '../lib/supabase';
import type { Site } from '../types';

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export const SiteList: React.FC = () => {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [sites, setSites]       = useState<Site[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState('');
  const [newDesc,  setNewDesc]  = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal,setRenameVal]= useState('');

  const refresh = async () => setSites(await getSites());

  useEffect(() => { refresh(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const site = await createSite(newName.trim(), newDesc.trim());
    setNewName(''); setNewDesc(''); setCreating(false);
    navigate(`/site/${site.id}`);
  };

  const handleDelete = async (site: Site) => {
    if (!confirm(`Delete "${site.name}"? All saved pages will be lost.`)) return;
    await deleteSite(site.id);
    refresh();
  };

  const handleRename = async (site: Site) => {
    if (!renameVal.trim() || renameVal.trim() === site.name) { setRenaming(null); return; }
    await updateSite(site.id, { name: renameVal.trim() });
    setRenaming(null);
    refresh();
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f7' }}>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e5ea', padding: '0 32px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#1d1d1f', letterSpacing: '-0.02em' }}>◈ GJS Editor</span>
          <span style={{ fontSize: 11, color: '#86868b', marginTop: 2 }}>Multi-site visual editor</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isRemote && (
            <button
              onClick={signOut}
              style={{ background: 'transparent', color: '#86868b', border: '1px solid #d2d2d7', borderRadius: 9999, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}
            >
              Sign out
            </button>
          )}
          <button
            onClick={() => setCreating(true)}
            style={{ background: '#0066cc', color: '#fff', border: 'none', borderRadius: 9999, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + New Site
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>

        {/* New site form */}
        {creating && (
          <div style={{
            background: '#fff', border: '1px solid #e5e5ea', borderRadius: 16,
            padding: 24, marginBottom: 32, boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
          }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f', marginBottom: 16 }}>New Site</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              <input
                autoFocus
                placeholder="Site name  (e.g. Acme Corp)"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
                style={{ border: '1px solid #d2d2d7', borderRadius: 8, padding: '10px 14px', fontSize: 14, outline: 'none', color: '#1d1d1f' }}
              />
              <input
                placeholder="Short description  (optional)"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
                style={{ border: '1px solid #d2d2d7', borderRadius: 8, padding: '10px 14px', fontSize: 14, outline: 'none', color: '#1d1d1f' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                style={{
                  background: '#0066cc', color: '#fff', border: 'none', borderRadius: 9999,
                  padding: '8px 20px', fontSize: 13, fontWeight: 600,
                  cursor: newName.trim() ? 'pointer' : 'not-allowed', opacity: newName.trim() ? 1 : 0.4,
                }}
              >
                Create & Open Editor
              </button>
              <button
                onClick={() => { setCreating(false); setNewName(''); setNewDesc(''); }}
                style={{ background: 'transparent', color: '#86868b', border: '1px solid #d2d2d7', borderRadius: 9999, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {sites.length === 0 && !creating && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>◈</div>
            <p style={{ fontSize: 20, fontWeight: 600, color: '#1d1d1f', marginBottom: 8 }}>No sites yet</p>
            <p style={{ fontSize: 15, color: '#86868b', marginBottom: 24 }}>Create your first site to start building with GrapesJS.</p>
            <button
              onClick={() => setCreating(true)}
              style={{ background: '#0066cc', color: '#fff', border: 'none', borderRadius: 9999, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              + New Site
            </button>
          </div>
        )}

        {/* Site grid */}
        {sites.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {sites.map(site => (
              <div
                key={site.id}
                style={{
                  background: '#fff', border: '1px solid #e5e5ea', borderRadius: 16,
                  overflow: 'hidden', display: 'flex', flexDirection: 'column',
                  transition: 'box-shadow 0.2s, transform 0.2s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.10)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; (e.currentTarget as HTMLDivElement).style.transform = 'none'; }}
              >
                {/* Card top — colour band */}
                <div style={{ height: 6, background: 'linear-gradient(90deg, #0066cc, #6d28d9)' }} />

                <div style={{ padding: '18px 20px', flex: 1 }}>
                  {renaming === site.id ? (
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onBlur={() => handleRename(site)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRename(site); if (e.key === 'Escape') setRenaming(null); }}
                      style={{ width: '100%', border: '1px solid #0066cc', borderRadius: 6, padding: '5px 8px', fontSize: 15, fontWeight: 600, outline: 'none', color: '#1d1d1f', marginBottom: 6 }}
                    />
                  ) : (
                    <p
                      style={{ fontSize: 15, fontWeight: 700, color: '#1d1d1f', marginBottom: 4, cursor: 'default' }}
                      onDoubleClick={() => { setRenaming(site.id); setRenameVal(site.name); }}
                      title="Double-click to rename"
                    >
                      {site.name}
                    </p>
                  )}
                  {site.description && (
                    <p style={{ fontSize: 12, color: '#86868b', marginBottom: 8, lineHeight: 1.5 }}>{site.description}</p>
                  )}
                  <p style={{ fontSize: 11, color: '#aeaeb2', marginTop: 6 }}>
                    {site.pages.length} page{site.pages.length !== 1 ? 's' : ''} · Updated {formatDate(site.updatedAt)}
                  </p>
                </div>

                {/* Page pills */}
                <div style={{ padding: '0 20px 14px', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {site.pages.map(p => (
                    <span key={p.key} style={{ fontSize: 10, fontWeight: 500, background: '#f5f5f7', color: '#86868b', padding: '3px 8px', borderRadius: 9999, border: '1px solid #e5e5ea' }}>
                      {p.label}
                    </span>
                  ))}
                </div>

                {/* Actions */}
                <div style={{ borderTop: '1px solid #f0f0f5', display: 'flex' }}>
                  <button
                    onClick={() => navigate(`/site/${site.id}`)}
                    style={{ flex: 1, padding: '11px 0', fontSize: 13, fontWeight: 600, color: '#0066cc', background: 'transparent', border: 'none', cursor: 'pointer', borderRight: '1px solid #f0f0f5' }}
                  >
                    Open Editor →
                  </button>
                  <button
                    onClick={() => handleDelete(site)}
                    style={{ padding: '11px 16px', fontSize: 12, color: '#86868b', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    title="Delete site"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
