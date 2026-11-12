/**
 * Мини-сервер dist/ для tenant:verify: файл, если он есть, иначе правила dist/_redirects
 * (:placeholder и *, статус 200 = rewrite) — как статический хостинг вроде Cloudflare Pages.
 * Только для локальной проверки; на сервере то же проверяется через --base-url.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

interface Rule {
  from: RegExp;
  names: string[];
  to: string;
  status: number;
}

function parseRedirects(file: string): Rule[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .flatMap((line) => {
      const [from, to, status] = line.split(/\s+/);
      if (!from || !to) return [];
      const names: string[] = [];
      const pattern = from
        .split('/')
        .map((seg) => {
          if (seg === '*') {
            names.push('splat');
            return '(.*)';
          }
          if (seg.startsWith(':')) {
            names.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/');
      return [{ from: new RegExp(`^${pattern}$`), names, to, status: Number(status ?? 301) }];
    });
}

function resolveFile(root: string, urlPath: string): string | null {
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(root, rel);
  if (!file.startsWith(root)) return null;
  if (existsSync(file) && statSync(file).isFile()) return file;
  const index = path.join(file, 'index.html');
  if (existsSync(index)) return index;
  return null;
}

export async function startStaticServer(root: string): Promise<{ url: string; server: Server }> {
  const rules = parseRedirects(path.join(root, '_redirects'));
  const server = createServer((req, res) => {
    const urlPath = new URL(req.url ?? '/', 'http://x').pathname;
    let file = resolveFile(root, urlPath);
    if (!file) {
      for (const rule of rules) {
        const m = rule.from.exec(urlPath);
        if (!m) continue;
        let target = rule.to;
        rule.names.forEach((name, i) => {
          target = target.replace(name === 'splat' ? ':splat' : `:${name}`, m[i + 1] ?? '');
        });
        if (rule.status !== 200) {
          res.writeHead(rule.status, { location: target }).end();
          return;
        }
        file = resolveFile(root, target);
        break;
      }
    }
    if (!file) {
      res.writeHead(404).end('not found');
      return;
    }
    res
      .writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
      .end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}
