/**
 * Web dashboard server.
 * 
 * Provides REST API, static web dashboard, and setup wizard for
 * managing the IPFS swarm from a browser.
 * 
 * Security: Binds to localhost by default. Remote access requires
 * --host flag. API token required for non-localhost requests.
 */
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import http from 'node:http';
import { log } from '../utils/logger.js';
import { loadConfig, updateConfig } from '../services/config.js';
import { isDaemonRunning, getPeerId, getSwarmPeers, getNodeIdentity, getBandwidthStats, getRepoStats, startDaemon, stopDaemon } from '../services/daemon.js';
import { addFile, catFile, pinFile, unpinFile, listPins, getFileInfo, listMFS, formatBytes, getFileToTemp } from '../services/file-manager.js';
import { readSwarmKey, generateSwarmKey, regenerateSwarmKey, installSwarmKey, exportKeyEncrypted, serveKey } from '../services/swarm-key.js';
import { detectTailscale, getExternalIP, getLocalIP, buildMultiaddr, findAvailablePort } from '../services/network.js';
import { detectKubo, installKubo, initializeIpfs, configureIpfsForPrivateSwarm } from '../services/kubo.js';
import { clearIpfsCache } from '../utils/exec.js';
import { validatePort } from '../utils/validator.js';
import { SWARM_KEY_PATH, CONFIG_DIR } from '../utils/constants.js';

// ── File Metadata Store ──
const METADATA_PATH = path.join(CONFIG_DIR, 'file-metadata.json');

interface FileMeta {
    name: string;
    mimeType: string;
    size: number;
    addedAt: string;
}

function loadMetadata(): Record<string, FileMeta> {
    try {
        if (fs.existsSync(METADATA_PATH)) return JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
    } catch { /* corrupt file */ }
    return {};
}

function saveMetadata(meta: Record<string, FileMeta>): void {
    try {
        if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(METADATA_PATH, JSON.stringify(meta, null, 2));
    } catch { /* */ }
}

function setFileMeta(cid: string, name: string, mimeType: string, size: number): void {
    const meta = loadMetadata();
    meta[cid] = { name, mimeType, size, addedAt: new Date().toISOString() };
    saveMetadata(meta);
}

function getFileMeta(cid: string): FileMeta | null {
    return loadMetadata()[cid] ?? null;
}

// MIME type detection from file extension
const MIME_MAP: Record<string, string> = {
    '.txt': 'text/plain', '.html': 'text/html', '.htm': 'text/html',
    '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json',
    '.xml': 'text/xml', '.csv': 'text/csv', '.md': 'text/markdown',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.bmp': 'image/bmp',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.avi': 'video/x-msvideo',
    '.pdf': 'application/pdf', '.zip': 'application/zip',
    '.tar': 'application/x-tar', '.gz': 'application/gzip',
    '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.eot': 'application/vnd.ms-fontobject', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function guessMime(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    return MIME_MAP[ext] || 'application/octet-stream';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Upload limits: 100MB max file size
const upload = multer({
    dest: os.tmpdir(),
    limits: {
        fileSize: 100 * 1024 * 1024,
        files: 10,
    },
});

export interface WebServerOptions {
    port: number;
    host?: string;
    apiToken?: string;
    setupMode?: boolean;
}

export async function startWebServer(options: WebServerOptions | number): Promise<void> {
    const opts: WebServerOptions = typeof options === 'number'
        ? { port: options, host: '127.0.0.1' }
        : options;

    const { port, host = '127.0.0.1', setupMode = false } = opts;
    const apiToken = opts.apiToken ?? crypto.randomBytes(16).toString('hex');

    const app = express();
    const server = http.createServer(app);

    app.use(express.json());

    // ── Security: CORS + Localhost Guard ──
    app.use((req, res, next) => {
        const origin = req.headers.origin ?? '';
        const remoteIP = req.ip ?? req.socket.remoteAddress ?? '';
        const isLocalhost = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteIP);

        if (isLocalhost) {
            res.header('Access-Control-Allow-Origin', origin || '*');
            res.header('Access-Control-Allow-Headers', 'Content-Type, X-Pin, X-Api-Token');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
            return next();
        }

        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
            const token = req.headers['x-api-token'] as string;
            if (token !== apiToken) {
                res.status(403).json({ error: 'API token required for remote mutation requests' });
                return;
            }
        }

        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Headers', 'Content-Type, X-Pin, X-Api-Token');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
        next();
    });

    // ── Static Dashboard ──
    const publicDir = path.join(__dirname, '..', 'web', 'public');
    const distPublicDir = path.join(__dirname, 'public');
    const staticDir = fs.existsSync(publicDir) ? publicDir : distPublicDir;

    if (fs.existsSync(staticDir)) {
        app.use(express.static(staticDir));
    }

    // ══════════════════════════════════════════
    //  SETUP WIZARD API
    // ══════════════════════════════════════════

    // GET /api/setup/status — Check if node is initialized
    app.get('/api/setup/status', (_req, res) => {
        const kubo = detectKubo();
        const cfg = loadConfig();
        const key = readSwarmKey();

        res.json({
            kuboInstalled: !!kubo,
            kuboVersion: kubo?.version ?? null,
            ipfsInitialized: kubo?.initialized ?? false,
            swarmKeyExists: !!key,
            nodeType: cfg.nodeType,
            configured: !!cfg.nodeId,
            setupMode,
        });
    });

    // POST /api/setup — Run full setup
    app.post('/api/setup', async (req, res) => {
        try {
            const {
                nodeType = 'bootstrap',
                swarmPort = 4001,
                apiPort = 5001,
                gatewayPort = 8080,
                bootstrapAddr = null,
            } = req.body;

            // Validate ports
            const validSwarmPort = validatePort(swarmPort);
            const validApiPort = validatePort(apiPort);
            const validGatewayPort = validatePort(gatewayPort);

            // Step 1: Install Kubo if needed
            const kuboPath = await installKubo();
            clearIpfsCache();

            // Step 2: Initialize IPFS
            await initializeIpfs(kuboPath);

            // Step 3: Generate or set swarm key
            if (nodeType === 'bootstrap') {
                generateSwarmKey();
            }
            installSwarmKey();

            // Step 4: Configure for private swarm
            await configureIpfsForPrivateSwarm(kuboPath, {
                swarmPort: validSwarmPort,
                apiPort: validApiPort,
                gatewayPort: validGatewayPort,
                bootstrapMultiaddr: bootstrapAddr,
            });

            // Step 5: Update config
            updateConfig({
                nodeType,
                basePort: validSwarmPort,
                apiPort: validApiPort,
                gatewayPort: validGatewayPort,
                bootstrapMultiaddr: bootstrapAddr,
                networkType: 'local',
            });

            res.json({ success: true, message: 'Setup complete!' });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ══════════════════════════════════════════
    //  DASHBOARD REST API
    // ══════════════════════════════════════════

    // GET /api/status
    app.get('/api/status', async (_req, res) => {
        const cfg = loadConfig();
        const running = isDaemonRunning();
        const peerId = running ? getPeerId() : null;
        const peers = running ? getSwarmPeers() : [];
        const bw = running ? getBandwidthStats() : null;
        const repo = running ? getRepoStats() : null;
        const ts = detectTailscale();

        res.json({
            running,
            nodeType: cfg.nodeType,
            peerId,
            peerCount: peers.length,
            peers,
            ports: { swarm: cfg.basePort, api: cfg.apiPort, gateway: cfg.gatewayPort },
            bandwidth: bw,
            storage: repo,
            network: {
                type: cfg.networkType,
                tailscale: ts.running ? { ip: ts.ip, hostname: ts.hostname } : null,
            },
            lastStarted: cfg.lastStarted,
        });
    });

    // GET /api/identity
    app.get('/api/identity', (_req, res) => {
        const identity = getNodeIdentity();
        if (!identity) { res.status(503).json({ error: 'Daemon not running' }); return; }
        res.json(identity);
    });

    // GET /api/peers
    app.get('/api/peers', (_req, res) => {
        const peers = getSwarmPeers();
        res.json({ count: peers.length, peers });
    });

    // POST /api/files/upload
    app.post('/api/files/upload', upload.single('file'), async (req, res) => {
        if (!req.file) { res.status(400).json({ error: 'No file provided' }); return; }

        try {
            const result = await addFile(req.file.path);
            const originalName = req.file.originalname;
            const mime = guessMime(originalName);

            // Store metadata for later download
            setFileMeta(result.cid, originalName, mime, result.size);

            res.json({
                cid: result.cid,
                name: originalName,
                size: result.size,
                sizeHuman: formatBytes(result.size),
                mimeType: mime,
                timestamp: new Date().toISOString(),
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        } finally {
            try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch { /* */ }
        }
    });

    // GET /api/files/:cid
    app.get('/api/files/:cid', (req, res) => {
        try {
            const info = getFileInfo(req.params.cid);
            if (!info) { res.status(404).json({ error: 'Not found' }); return; }
            res.json({ ...info, sizeHuman: formatBytes(info.size) });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/files/:cid/download — Fixed binary download with proper filename
    app.get('/api/files/:cid/download', async (req, res) => {
        try {
            const cid = req.params.cid;
            const tempPath = await getFileToTemp(cid);
            const stat = fs.statSync(tempPath);

            if (stat.isDirectory()) {
                res.json({ error: 'CID points to a directory. Download individual files.' });
                return;
            }

            // Look up original filename and MIME type from metadata
            const meta = getFileMeta(cid);
            const filename = meta?.name || (req.query.name as string) || cid;
            const mime = meta?.mimeType || guessMime(filename);

            res.setHeader('Content-Type', mime);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Length', stat.size);

            const stream = fs.createReadStream(tempPath);
            stream.pipe(res);
            stream.on('end', () => {
                try { fs.unlinkSync(tempPath); } catch { /* */ }
            });
            stream.on('error', () => {
                try { fs.unlinkSync(tempPath); } catch { /* */ }
                if (!res.headersSent) res.status(500).json({ error: 'Download failed' });
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/files/:cid/content — Text content (kept for API use)
    app.get('/api/files/:cid/content', (req, res) => {
        try {
            const content = catFile(req.params.cid);
            res.type('text/plain');
            res.send(content);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/files/:cid/pin
    app.post('/api/files/:cid/pin', (req, res) => {
        try { pinFile(req.params.cid); res.json({ success: true, cid: req.params.cid }); }
        catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // DELETE /api/files/:cid/pin
    app.delete('/api/files/:cid/pin', (req, res) => {
        try { unpinFile(req.params.cid); res.json({ success: true, cid: req.params.cid }); }
        catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // GET /api/pins — includes metadata (name, size, addedAt)
    app.get('/api/pins', (_req, res) => {
        const pins = listPins();
        const meta = loadMetadata();
        const enriched = pins.map(p => {
            const m = meta[p.cid];
            return {
                cid: p.cid,
                type: p.type,
                name: m?.name || null,
                mimeType: m?.mimeType || null,
                size: m?.size || null,
                sizeHuman: m?.size ? formatBytes(m.size) : null,
                addedAt: m?.addedAt || null,
            };
        });
        res.json({ count: enriched.length, pins: enriched });
    });

    // POST /api/pin-cid — Pin an arbitrary CID with optional alias
    app.post('/api/pin-cid', (req, res) => {
        try {
            const { cid, name: alias } = req.body;
            if (!cid) { res.status(400).json({ error: 'CID is required' }); return; }

            pinFile(cid);

            // Store alias metadata if provided
            if (alias) {
                const mime = guessMime(alias);
                const info = getFileInfo(cid);
                setFileMeta(cid, alias, mime, info?.size || 0);
            }

            res.json({ success: true, cid, name: alias || null });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/mfs
    app.get('/api/mfs', (req, res) => {
        const mfsPath = (req.query.path as string) || '/';
        const files = listMFS(mfsPath);
        res.json({ path: mfsPath, files });
    });

    // GET /api/network
    app.get('/api/network', async (_req, res) => {
        const cfg = loadConfig();
        const peerId = getPeerId();
        const ts = detectTailscale();
        const externalIP = await getExternalIP();

        let addresses = null;
        if (peerId) { addresses = await buildMultiaddr(peerId, cfg.basePort); }

        res.json({
            peerId,
            addresses,
            tailscale: {
                installed: ts.installed, running: ts.running,
                ip: ts.ip, hostname: ts.hostname,
                magicDNS: ts.magicDNS, peers: ts.peers,
            },
            externalIP,
        });
    });

    // GET /api/key — basic key info
    app.get('/api/key', (_req, res) => {
        const key = readSwarmKey();
        const lines = key?.split('\n').filter(Boolean) ?? [];
        const keyHex = lines[2] ?? '';
        res.json({
            exists: !!key,
            fingerprint: key ? `${keyHex.substring(0, 8)}...${keyHex.slice(-8)}` : null,
        });
    });

    // ══════════════════════════════════════════
    //  COMMAND CENTER APIs
    // ══════════════════════════════════════════

    // POST /api/daemon/start — Start the IPFS daemon
    app.post('/api/daemon/start', async (_req, res) => {
        try {
            const success = await startDaemon();
            if (success) {
                res.json({ success: true, message: 'Daemon started' });
            } else {
                res.status(500).json({ error: 'Failed to start daemon' });
            }
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/daemon/stop — Stop the IPFS daemon
    app.post('/api/daemon/stop', async (_req, res) => {
        try {
            await stopDaemon();
            res.json({ success: true, message: 'Daemon stopped' });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/key/full — Full key info for management page
    app.get('/api/key/full', (_req, res) => {
        const key = readSwarmKey();
        const cfg = loadConfig();
        const lines = key?.split('\n').filter(Boolean) ?? [];
        const keyHex = lines[2] ?? '';

        res.json({
            exists: !!key,
            keyPath: SWARM_KEY_PATH,
            fingerprint: key ? `${keyHex.substring(0, 8)}...${keyHex.slice(-8)}` : null,
            fullKey: key ?? null,
            nodeType: cfg.nodeType,
            nodeId: cfg.nodeId ?? null,
        });
    });

    // POST /api/key/regenerate — Regenerate swarm key
    app.post('/api/key/regenerate', (_req, res) => {
        try {
            const keyPath = regenerateSwarmKey();
            installSwarmKey(keyPath);
            res.json({ success: true, message: 'Swarm key regenerated. All peers must reimport.' });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/key/serve — Start one-time key server
    let activeKeyServer: { pin: string; url: string } | null = null;
    app.post('/api/key/serve', async (req, res) => {
        try {
            const servePort = req.body?.port ?? 8899;
            const result = await serveKey(servePort, false);
            activeKeyServer = result;
            res.json({
                success: true,
                pin: result.pin,
                url: result.url,
                port: servePort,
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/sharing — Auto-generated copyable sharing commands
    app.get('/api/sharing', async (_req, res) => {
        try {
            const cfg = loadConfig();
            const peerId = getPeerId();
            const localIP = getLocalIP() ?? '127.0.0.1';
            const ts = detectTailscale();
            const externalIP = await getExternalIP();
            const swarmPort = cfg.basePort ?? 4001;

            // Build bootstrap multiaddrs for different scenarios
            const commands: Record<string, any> = {};

            if (peerId) {
                // Local network sharing
                commands.local = {
                    label: 'Local Network (LAN)',
                    bootstrapAddr: `/ip4/${localIP}/tcp/${swarmPort}/p2p/${peerId}`,
                    joinCommand: `ipfs-swarm init --regular --bootstrap-addr "/ip4/${localIP}/tcp/${swarmPort}/p2p/${peerId}"`,
                };

                // Tailscale sharing
                if (ts.running && ts.ip) {
                    commands.tailscale = {
                        label: 'Tailscale VPN',
                        bootstrapAddr: `/ip4/${ts.ip}/tcp/${swarmPort}/p2p/${peerId}`,
                        joinCommand: `ipfs-swarm init --regular --bootstrap-addr "/ip4/${ts.ip}/tcp/${swarmPort}/p2p/${peerId}"`,
                    };
                }

                // External sharing (public IP)
                if (externalIP) {
                    commands.external = {
                        label: 'External (Public IP — needs port forwarding)',
                        bootstrapAddr: `/ip4/${externalIP}/tcp/${swarmPort}/p2p/${peerId}`,
                        joinCommand: `ipfs-swarm init --regular --bootstrap-addr "/ip4/${externalIP}/tcp/${swarmPort}/p2p/${peerId}"`,
                    };
                }
            }

            // Key transfer commands
            commands.keyTransfer = {
                serveCommand: 'ipfs-swarm key serve',
                fetchCommand: `ipfs-swarm key fetch --host ${localIP} --port 8899 --pin <PIN>`,
                scpCommand: `scp ${SWARM_KEY_PATH} user@remote:~/.ipfs/swarm.key`,
            };

            // Quick setup commands for colleagues
            commands.quickSetup = {
                step1: 'npm install -g ipfs-swarm-cli',
                step2: `ipfs-swarm key fetch --host ${localIP} --port 8899 --pin <PIN>`,
                step3: commands.local
                    ? `ipfs-swarm init --regular --bootstrap-addr "${commands.local.bootstrapAddr}"`
                    : 'ipfs-swarm init --regular',
                step4: 'ipfs-swarm start',
                step5: 'ipfs-swarm status',
            };

            res.json({
                peerId,
                localIP,
                tailscaleIP: ts.ip,
                externalIP,
                swarmPort,
                commands,
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });


    // ── WebSocket for live updates (shared broadcast) ──
    const wss = new WebSocketServer({ server, path: '/ws' });
    const clients = new Set<WebSocket>();

    wss.on('connection', (ws) => {
        clients.add(ws);
        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
    });

    const broadcastInterval = setInterval(() => {
        if (clients.size === 0) return;
        try {
            const running = isDaemonRunning();
            const peers = running ? getSwarmPeers() : [];
            const bw = running ? getBandwidthStats() : null;
            const payload = JSON.stringify({
                type: 'status',
                data: { running, peerCount: peers.length, bandwidth: bw },
            });
            for (const ws of clients) {
                try { if (ws.readyState === ws.OPEN) ws.send(payload); } catch { /* */ }
            }
        } catch { /* */ }
    }, 3000);

    // ── SPA Fallback ──
    app.get('*', (_req, res) => {
        const indexPath = path.join(staticDir, 'index.html');
        if (fs.existsSync(indexPath)) { res.sendFile(indexPath); }
        else { res.status(404).json({ error: 'Dashboard not found' }); }
    });

    // ── Graceful Shutdown ──
    function shutdown() {
        log.info('Shutting down web server...');
        clearInterval(broadcastInterval);
        for (const ws of clients) { try { ws.close(1001, 'Shutting down'); } catch { /* */ } }
        clients.clear();
        wss.close();
        server.close(() => { log.success('Web server stopped'); process.exit(0); });
        setTimeout(() => process.exit(1), 5000);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // ── Start ──
    server.listen(port, host, () => {
        log.banner();
        log.section('Web Dashboard');
        const displayHost = host === '0.0.0.0' ? 'localhost' : host;
        log.kv('URL', `http://${displayHost}:${port}`);
        log.kv('API', `http://${displayHost}:${port}/api/status`);

        if (setupMode) {
            log.kv('Mode', 'Setup Wizard');
        }

        if (host !== '127.0.0.1' && host !== 'localhost') {
            log.section('Remote Access');
            log.kv('API Token', apiToken);
            log.warn('Remote mutation requests require X-Api-Token header');
        }

        log.br();
        log.info('Press Ctrl+C to stop.');
    });
}
