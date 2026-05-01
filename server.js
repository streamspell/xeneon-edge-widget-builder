const http = require('http');
const dns = require('dns').promises;
const fsp = require('fs/promises');
const net = require('net');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8090);

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024);
const MAX_EXTRACTED_BYTES = Number(process.env.MAX_EXTRACTED_BYTES || 64 * 1024 * 1024);
const MAX_ZIP_FILES = Number(process.env.MAX_ZIP_FILES || 512);
const MAX_SINGLE_FILE_BYTES = Number(process.env.MAX_SINGLE_FILE_BYTES || 8 * 1024 * 1024);
const VALIDATION_TIMEOUT_MS = Number(process.env.VALIDATION_TIMEOUT_MS || 15000);
const MAX_CONCURRENT_VALIDATIONS = Number(process.env.MAX_CONCURRENT_VALIDATIONS || 1);
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 8000);
const PROXY_MAX_RESPONSE_BYTES = Number(process.env.PROXY_MAX_RESPONSE_BYTES || 2 * 1024 * 1024);
const WIDGET_SESSION_TTL_MS = Number(process.env.WIDGET_SESSION_TTL_MS || 30 * 60 * 1000);
const MAX_WIDGET_SESSIONS = Number(process.env.MAX_WIDGET_SESSIONS || 12);
const DEBUG_ERRORS = process.env.DEBUG === '1' || process.env.NODE_ENV === 'development';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

let activeValidations = 0;
const widgetSessions = new Map();

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function safePath(urlPath) {
  let clean = null;
  try {
    clean = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const rel = clean === '/' ? '/index.html' : clean;
  const abs = path.normalize(path.join(ROOT, rel));
  const relToRoot = path.relative(ROOT, abs);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) return null;
  return abs;
}

function decodeSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isSafeArchivePath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath) return false;
  const decoded = decodeSafe(rawPath);
  if (decoded == null) return false;

  const normalized = decoded.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;
  if (/^[A-Za-z]:\//.test(normalized)) return false;

  const lower = normalized.toLowerCase();
  if (lower.includes('%2e') || lower.includes('%2f') || lower.includes('%5c')) return false;

  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return false;
  if (parts.some((part) => part === '.' || part === '..')) return false;
  return true;
}

function normalizeArchivePath(rawPath) {
  if (!isSafeArchivePath(rawPath)) return null;
  return decodeSafe(rawPath).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function pruneWidgetSessions() {
  const now = Date.now();
  const entries = [...widgetSessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);

  for (const [sessionId, session] of entries) {
    if (!session || now - session.createdAt > WIDGET_SESSION_TTL_MS) {
      widgetSessions.delete(sessionId);
    }
  }

  while (widgetSessions.size > MAX_WIDGET_SESSIONS) {
    const oldest = [...widgetSessions.keys()][0];
    if (!oldest) break;
    widgetSessions.delete(oldest);
  }
}

function parseContentLength(req) {
  const raw = req.headers['content-length'];
  if (!raw) return null;
  const value = Number.parseInt(String(raw), 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function isAllowedProxyContentType(contentType) {
  const value = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  return /^(application\/(rss\+xml|atom\+xml|xml|json|[\w.+-]+\+xml|[\w.+-]+\+json)|text\/(plain|xml|json))$/.test(value);
}

function isPrivateIpv4(host) {
  const parts = host.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;

  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  if (host === '255.255.255.255') return true;
  if (host === '169.254.169.254') return true;
  return false;
}

function isPrivateIpv6(host) {
  const normalized = host.toLowerCase();
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fe80:')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized === '::ffff:127.0.0.1'
    || normalized === '::ffff:169.254.169.254';
}

function isBlockedHost(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true;

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isPrivateIpv4(normalized);
  if (ipVersion === 6) return isPrivateIpv6(normalized);
  return false;
}

async function resolveProxyTarget(hostname) {
  if (isBlockedHost(hostname)) {
    throw new Error('Blocked proxy destination.');
  }

  const records = await dns.lookup(hostname, { all: true });
  if (!records.length) {
    throw new Error('Could not resolve proxy destination.');
  }

  for (const record of records) {
    if ((record.family === 4 && isPrivateIpv4(record.address)) || (record.family === 6 && isPrivateIpv6(record.address))) {
      throw new Error('Blocked proxy destination.');
    }
  }
}

async function readProxyResponse(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const textBody = await response.text();
    if (Buffer.byteLength(textBody) > PROXY_MAX_RESPONSE_BYTES) {
      throw new Error('Proxy response exceeded size limit.');
    }
    return textBody;
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > PROXY_MAX_RESPONSE_BYTES) {
      throw new Error('Proxy response exceeded size limit.');
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function handleProxyRequest(req, res, requestUrl) {
  if (req.headers['x-widget-proxy-enabled'] !== '1') {
    json(res, 403, { ok: false, error: 'Local proxy is disabled.' });
    return;
  }

  const rawUrl = requestUrl.searchParams.get('url') || '';
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    json(res, 400, { ok: false, error: 'Invalid proxy URL.' });
    return;
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    json(res, 400, { ok: false, error: 'Proxy only allows http and https URLs.' });
    return;
  }

  try {
    await resolveProxyTarget(target.hostname);
  } catch (error) {
    json(res, 403, { ok: false, error: error.message || 'Blocked proxy destination.' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      method: 'GET',
      headers: {
        Accept: req.headers.accept || 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/plain;q=0.8'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    const contentType = upstream.headers.get('content-type') || '';
    if (!isAllowedProxyContentType(contentType)) {
      json(res, 415, { ok: false, error: `Blocked proxy content type: ${contentType || 'unknown'}` });
      return;
    }

    const body = await readProxyResponse(upstream);
    res.writeHead(upstream.status, {
      'Content-Type': contentType || 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(body);
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Proxy request timed out.'
      : (DEBUG_ERRORS ? String(error.message || error) : 'Proxy request failed.');
    json(res, 502, { ok: false, error: message });
  } finally {
    clearTimeout(timeout);
  }
}

async function readBody(req, sizeLimit = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > sizeLimit) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function semverLike(v) {
  return typeof v === 'string' && /^\d+\.\d+\.\d+([-.].+)?$/.test(v);
}

function reverseDnsLike(v) {
  return typeof v === 'string' && /^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(v);
}

function validateManifestFallback(manifest, filesSet) {
  const errors = [];
  const warnings = [];

  const required = [
    'author', 'id', 'name', 'description', 'version', 'preview_icon',
    'min_framework_version', 'os', 'supported_devices'
  ];

  for (const key of required) {
    if (!(key in manifest)) errors.push(`Missing required manifest field: ${key}`);
  }

  if (!reverseDnsLike(manifest.id || '')) warnings.push('manifest.id should be reverse-DNS style (example: com.author.widget).');
  if (!semverLike(manifest.version || '')) warnings.push('manifest.version should follow semver (example: 1.0.0).');
  if (!semverLike(manifest.min_framework_version || '')) warnings.push('manifest.min_framework_version should follow semver (example: 1.0.0).');

  if (manifest.preview_icon && !filesSet.has(String(manifest.preview_icon).replace(/^\/+/, ''))) {
    errors.push(`preview_icon file not found: ${manifest.preview_icon}`);
  }

  if (Array.isArray(manifest.os)) {
    const platforms = manifest.os.map((x) => x && x.platform).filter(Boolean);
    if (!platforms.length) errors.push('manifest.os must include at least one platform object.');
  }

  if (Array.isArray(manifest.supported_devices)) {
    if (!manifest.supported_devices.length) errors.push('manifest.supported_devices must include at least one device type.');
  }

  if ('interactive' in manifest && typeof manifest.interactive !== 'boolean') {
    errors.push('manifest.interactive must be boolean when provided.');
  }

  if (Array.isArray(manifest.modules)) {
    for (const p of manifest.modules) {
      const rel = String(p).replace(/^\/+/, '');
      if (!filesSet.has(rel)) warnings.push(`modules entry not found in package: ${p}`);
    }
  }

  return { errors, warnings };
}

function runProcess(cmd, args, { timeoutMs, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let done = false;
    let timer = null;

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (done) return;
        child.kill('SIGKILL');
        reject(new Error(`Process timeout: ${cmd}`));
      }, timeoutMs);
    }

    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    child.on('error', (error) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function withTimeout(promise, timeoutMs, label) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function runValidation(fileName, zipBuffer) {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'xeneon-widget-'));
  const safeName = path.basename(String(fileName || 'widget.icuewidget')).replace(/[^\w.\-]/g, '_');
  const zipPath = path.join(tmpBase, safeName || 'widget.icuewidget');
  const extractDir = path.join(tmpBase, 'widget');

  try {
    await fsp.mkdir(extractDir, { recursive: true });
    await fsp.writeFile(zipPath, zipBuffer);

    const pyExtract = await withTimeout(
      runProcess('python3', [
        '-c',
        [
          'import os,sys,re,zipfile',
          'zip_path=sys.argv[1]',
          'out=os.path.realpath(sys.argv[2])',
          'max_files=int(sys.argv[3])',
          'max_total=int(sys.argv[4])',
          'max_single=int(sys.argv[5])',
          'max_depth=int(sys.argv[6])',
          'seen=0',
          'total=0',
          'def bad(name):',
          '  if not name: return True',
          '  n=name.replace("\\\\","/")',
          '  if n.startswith("/") or re.match(r"^[A-Za-z]:", n): return True',
          '  parts=[p for p in n.split("/") if p not in ("", ".")]',
          '  if any(p==".." for p in parts): return True',
          '  if len(parts)==0 or len(parts)>max_depth: return True',
          '  lower=n.lower()',
          '  if "%2e" in lower or "%2f" in lower or "%5c" in lower: return True',
          '  return False',
          'with zipfile.ZipFile(zip_path) as z:',
          '  for info in z.infolist():',
          '    if info.is_dir(): continue',
          '    name=info.filename',
          '    if bad(name): raise ValueError(f"Unsafe archive path: {name}")',
          '    seen += 1',
          '    if seen > max_files: raise ValueError("Too many files in archive")',
          '    if info.file_size > max_single: raise ValueError(f"File too large in archive: {name}")',
          '    total += info.file_size',
          '    if total > max_total: raise ValueError("Archive extracted size exceeds limit")',
          '    dest=os.path.realpath(os.path.join(out,name.replace("\\\\","/")))',
          '    if not (dest==out or dest.startswith(out+os.sep)): raise ValueError(f"Unsafe archive destination: {name}")',
          '  for info in z.infolist():',
          '    if info.is_dir(): continue',
          '    dest=os.path.realpath(os.path.join(out,info.filename.replace("\\\\","/")))',
          '    os.makedirs(os.path.dirname(dest), exist_ok=True)',
          '    with z.open(info, "r") as src, open(dest, "wb") as dst: dst.write(src.read())'
        ].join('\n'),
        zipPath,
        extractDir,
        String(MAX_ZIP_FILES),
        String(MAX_EXTRACTED_BYTES),
        String(MAX_SINGLE_FILE_BYTES),
        '24'
      ], { timeoutMs: VALIDATION_TIMEOUT_MS }),
      VALIDATION_TIMEOUT_MS,
      'Archive extraction'
    );

    if (pyExtract.code !== 0) {
      return {
        ok: false,
        source: 'fallback',
        errors: ['Could not extract widget archive.'],
        warnings: [pyExtract.stderr || pyExtract.stdout].filter(Boolean)
      };
    }

    const listProc = await withTimeout(
      runProcess('python3', ['-c', [
        'import os,sys,json',
        'root=sys.argv[1]',
        'out=[]',
        'for b,_,fs in os.walk(root):',
        '  for f in fs:',
        '    p=os.path.relpath(os.path.join(b,f),root).replace("\\\\","/")',
        '    out.append(p)',
        'print(json.dumps(out))'
      ].join('\n'), extractDir], { timeoutMs: Math.max(2000, VALIDATION_TIMEOUT_MS / 2) }),
      Math.max(2000, VALIDATION_TIMEOUT_MS / 2),
      'Archive listing'
    );

    const files = listProc.code === 0 ? JSON.parse(listProc.stdout || '[]') : [];
    const filesSet = new Set(files);

    const errors = [];
    const warnings = [];

    if (!filesSet.has('index.html')) errors.push('Missing required file: index.html');
    if (!filesSet.has('manifest.json')) errors.push('Missing required file: manifest.json');

    let manifest = null;
    if (filesSet.has('manifest.json')) {
      try {
        manifest = JSON.parse(await fsp.readFile(path.join(extractDir, 'manifest.json'), 'utf8'));
      } catch (e) {
        errors.push(`manifest.json is not valid JSON: ${e.message}`);
      }
    }

    let cliResult = null;
    const hasCli = (await runProcess('sh', ['-lc', 'command -v icuewidget'], { timeoutMs: 2000 })).code === 0;
    if (hasCli) {
      const cli = await withTimeout(
        runProcess('icuewidget', ['validate', extractDir], { timeoutMs: VALIDATION_TIMEOUT_MS }),
        VALIDATION_TIMEOUT_MS,
        'icuewidget validate'
      );
      cliResult = {
        exitCode: cli.code ?? 1,
        stdout: (cli.stdout || '').trim(),
        stderr: (cli.stderr || '').trim()
      };
    }

    if (manifest) {
      const fb = validateManifestFallback(manifest, filesSet);
      errors.push(...fb.errors);
      warnings.push(...fb.warnings);
    }

    const cliPassed = cliResult ? cliResult.exitCode === 0 : null;
    const fallbackPassed = errors.length === 0;

    return {
      ok: cliResult ? cliPassed && fallbackPassed : fallbackPassed,
      source: cliResult ? 'icuewidget+fallback' : 'fallback',
      cliAvailable: hasCli,
      errors,
      warnings,
      cli: cliResult,
      summary: {
        fileCount: files.length,
        widgetName: manifest && manifest.name ? manifest.name : null,
        widgetVersion: manifest && manifest.version ? manifest.version : null
      }
    };
  } finally {
    await fsp.rm(tmpBase, { recursive: true, force: true });
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'POST' && req.url === '/api/validate') {
    const contentLength = parseContentLength(req);
    if (contentLength != null && contentLength > MAX_UPLOAD_BYTES) {
      json(res, 413, { ok: false, error: 'Upload exceeds size limit.' });
      return;
    }

    if (activeValidations >= MAX_CONCURRENT_VALIDATIONS) {
      json(res, 429, { ok: false, error: 'Validation is busy. Please retry shortly.' });
      return;
    }

    activeValidations += 1;
    try {
      const raw = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        json(res, 400, { ok: false, error: 'Invalid JSON payload.' });
        return;
      }

      if (!payload || !payload.fileName || !payload.base64) {
        json(res, 400, { ok: false, error: 'Invalid payload.' });
        return;
      }

      const buffer = Buffer.from(payload.base64, 'base64');
      if (!buffer.length) {
        json(res, 400, { ok: false, error: 'Invalid base64 widget payload.' });
        return;
      }
      if (buffer.length > MAX_UPLOAD_BYTES) {
        json(res, 413, { ok: false, error: 'Upload exceeds size limit.' });
        return;
      }

      const result = await withTimeout(
        runValidation(payload.fileName, buffer),
        VALIDATION_TIMEOUT_MS + 2000,
        'Validation'
      );
      json(res, 200, result);
      return;
    } catch (e) {
      console.error('Validation error:', e);
      json(res, 500, {
        ok: false,
        error: DEBUG_ERRORS ? String(e.message || e) : 'Validation failed unexpectedly.'
      });
      return;
    } finally {
      activeValidations = Math.max(0, activeValidations - 1);
    }
  }

  if (req.method === 'POST' && req.url === '/api/register-widget') {
    const contentLength = parseContentLength(req);
    if (contentLength != null && contentLength > MAX_UPLOAD_BYTES * 8) {
      json(res, 413, { ok: false, error: 'Widget registration payload exceeds size limit.' });
      return;
    }

    try {
      const raw = await readBody(req, MAX_UPLOAD_BYTES * 8);
      let payload;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        json(res, 400, { ok: false, error: 'Invalid JSON payload.' });
        return;
      }

      if (!payload || typeof payload.sessionId !== 'string' || !Array.isArray(payload.files)) {
        json(res, 400, { ok: false, error: 'Invalid widget registration payload.' });
        return;
      }

      pruneWidgetSessions();
      const files = new Map();
      for (const file of payload.files) {
        const safePath = normalizeArchivePath(file?.path || '');
        if (!safePath || typeof file?.base64 !== 'string' || !file.base64) {
          json(res, 400, { ok: false, error: 'Widget registration included an invalid file entry.' });
          return;
        }

        const bytes = Buffer.from(file.base64, 'base64');
        if (!bytes.length) {
          json(res, 400, { ok: false, error: `Invalid base64 asset for ${safePath}.` });
          return;
        }

        files.set(safePath, {
          contentType: typeof file.contentType === 'string' && file.contentType ? file.contentType : 'application/octet-stream',
          bytes
        });
      }

      widgetSessions.set(payload.sessionId, {
        createdAt: Date.now(),
        files
      });
      pruneWidgetSessions();
      json(res, 200, { ok: true, fileCount: files.size });
      return;
    } catch (error) {
      json(res, 500, {
        ok: false,
        error: DEBUG_ERRORS ? String(error.message || error) : 'Widget registration failed unexpectedly.'
      });
      return;
    }
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/proxy') {
    await handleProxyRequest(req, res, requestUrl);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname.startsWith('/__widget__/')) {
    pruneWidgetSessions();
    const rest = requestUrl.pathname.slice('/__widget__/'.length);
    const slashIndex = rest.indexOf('/');
    if (slashIndex === -1) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const sessionId = rest.slice(0, slashIndex);
    const safePath = normalizeArchivePath(rest.slice(slashIndex + 1));
    if (!safePath) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const file = widgetSessions.get(sessionId)?.files?.get(safePath);
    if (!file) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': file.contentType,
      'Cache-Control': 'no-store'
    });
    res.end(file.bytes);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  const abs = safePath(req.url || '/');
  if (!abs) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const st = await fsp.stat(abs);
    const filePath = st.isDirectory() ? path.join(abs, 'index.html') : abs;
    const ext = path.extname(filePath).toLowerCase();
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Xeneon widget preview running on http://127.0.0.1:${PORT}`);
});
