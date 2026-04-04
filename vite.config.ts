// @ts-nocheck
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const SITES_DIR = path.join(process.cwd(), 'sites');

// ── Claude API proxy (dev only) ───────────────────────────────────────────────
function claudeProxyPlugin() {
  return {
    name: 'claude-proxy',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: () => void) => {

        // ── Save page to disk (HTML + separate CSS file) ────────────────────
        if (req.url?.startsWith('/api/save-page') && req.method === 'POST') {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            try {
              const { siteId, pageKey, pageLabel, html, css } = JSON.parse(Buffer.concat(chunks).toString());
              const siteDir = path.join(SITES_DIR, siteId);
              fs.mkdirSync(siteDir, { recursive: true });
              // Write CSS to its own file
              fs.writeFileSync(path.join(siteDir, `${pageKey}.css`), css ?? '', 'utf8');
              // Write HTML linking the external CSS
              const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageLabel ?? pageKey}</title>
  <link rel="stylesheet" href="./${pageKey}.css">
</head>
<body>
${html}
</body>
</html>`;
              fs.writeFileSync(path.join(siteDir, `${pageKey}.html`), fullHtml, 'utf8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, path: path.join('sites', siteId, `${pageKey}.html`) }));
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        // ── Deploy site to Vercel ───────────────────────────────────────────
        if (req.url?.startsWith('/api/deploy-vercel') && req.method === 'POST') {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', async () => {
            try {
              const { siteId, siteName, vercelToken } = JSON.parse(Buffer.concat(chunks).toString());
              if (!vercelToken) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'No Vercel token provided.' }));
              }
              const siteDir = path.join(SITES_DIR, siteId);
              if (!fs.existsSync(siteDir)) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'No saved files found. Save the page first.' }));
              }

              // Read all files in the site directory
              const files = fs.readdirSync(siteDir)
                .filter(f => f.endsWith('.html') || f.endsWith('.css'))
                .map(f => ({
                  file: f,
                  data: fs.readFileSync(path.join(siteDir, f), 'utf8'),
                }));

              if (files.length === 0) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'No HTML/CSS files to deploy.' }));
              }

              // Build a map of page css content for inlining in alias files
              const cssMap: Record<string, string> = {};
              files.filter(f => f.file.endsWith('.css')).forEach(f => {
                const base = path.basename(f.file, '.css');
                cssMap[base] = f.data;
              });

              // Inline CSS into an HTML string (replaces <link rel="stylesheet"> with <style>)
              const inlineCss = (htmlData: string, base: string): string => {
                const css = cssMap[base] ?? '';
                return htmlData.replace(
                  /<link[^>]+rel=["']stylesheet["'][^>]*>/i,
                  css ? `<style>\n${css}\n</style>` : ''
                );
              };

              // Add index.html aliases for each page so Vercel routing works
              // home.html → index.html, about.html → about/index.html
              const extraFiles: { file: string; data: string }[] = [];
              files.forEach(f => {
                if (!f.file.endsWith('.html')) return;
                const base = path.basename(f.file, '.html');
                const inlined = inlineCss(f.data, base);
                if (base === 'home' || base === 'index') {
                  if (!files.find(x => x.file === 'index.html')) {
                    extraFiles.push({ file: 'index.html', data: inlined });
                  }
                } else {
                  extraFiles.push({ file: `${base}/index.html`, data: inlined });
                }
              });

              // Build Vercel deployment payload
              const projectName = (siteName || siteId)
                .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 40);

              const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${vercelToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  name: projectName,
                  files: [...files, ...extraFiles].map(f => ({
                    file: f.file,
                    data: f.data,
                    encoding: 'utf-8',
                  })),
                  projectSettings: { framework: null },
                  target: 'production',
                }),
              });

              const rawText = await deployRes.text();
              let deployData: any;
              try { deployData = JSON.parse(rawText); } catch {
                deployData = { error: `Vercel HTTP ${deployRes.status} — ${rawText.slice(0, 300) || 'empty response'}` };
              }
              if (!deployRes.ok) {
                res.statusCode = deployRes.status;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: deployData.error?.message ?? deployData.error ?? `Vercel HTTP ${deployRes.status}` }));
              }

              const url = deployData.url ? `https://${deployData.url}` : null;
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, url, id: deployData.id }));
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        // ── CMS read/write ─────────────────────────────────────────────────
        if (req.url?.startsWith('/api/cms')) {
          const urlObj = new URL(req.url, 'http://localhost');
          const siteId = urlObj.searchParams.get('siteId') ?? '';

          if (req.method === 'GET') {
            const cmsPath = path.join(SITES_DIR, siteId, 'cms.json');
            const data = fs.existsSync(cmsPath)
              ? JSON.parse(fs.readFileSync(cmsPath, 'utf8'))
              : { collections: {} };
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify(data));
          }

          if (req.method === 'POST') {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () => {
              try {
                const body = JSON.parse(Buffer.concat(chunks).toString());
                const siteDir = path.join(SITES_DIR, body.siteId ?? siteId);
                fs.mkdirSync(siteDir, { recursive: true });
                fs.writeFileSync(path.join(siteDir, 'cms.json'), JSON.stringify(body.cms, null, 2), 'utf8');
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true }));
              } catch (err: any) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: err.message }));
              }
            });
            return;
          }
        }

        // ── Serve saved site files for preview ─────────────────────────────
        if (req.url?.startsWith('/sites/')) {
          const filePath = path.join(process.cwd(), req.url.split('?')[0]);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            const mime: Record<string, string> = { '.css': 'text/css', '.json': 'application/json' };
            res.statusCode = 200;
            res.setHeader('Content-Type', mime[ext] ?? 'text/html; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.end(fs.readFileSync(filePath));
          }
          res.statusCode = 404;
          return res.end('Not found');
        }

        if (!req.url?.startsWith('/api/claude') || req.method !== 'POST') {
          return next();
        }
        const apiKey: string =
          (req.headers['x-api-key'] as string) ||
          process.env.ANTHROPIC_API_KEY ||
          '';
        if (!apiKey) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ error: 'No API key — enter it in the Claude panel or set ANTHROPIC_API_KEY in .env.local' }));
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', async () => {
          try {
            const bodyObj = JSON.parse(Buffer.concat(chunks).toString());
            bodyObj.stream = true; // force streaming
            const upstream = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify(bodyObj),
            });
            if (!upstream.ok || !upstream.body) {
              const errText = await upstream.text();
              res.statusCode = upstream.status;
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ error: errText.slice(0, 300) }));
            }
            // Pipe SSE stream to client
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('X-Accel-Buffering', 'no');
            const reader = (upstream.body as any).getReader();
            const pump = async () => {
              const { done, value } = await reader.read();
              if (done) { res.end(); return; }
              res.write(value);
              pump();
            };
            pump();
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), claudeProxyPlugin()],
  server: {
    port: 5174,
  },
});
