/**
 * Swarm key management — generation, encryption, and secure distribution.
 * 
 * Three secure key sharing methods:
 * 1. key serve  — One-time HTTPS micro-server with PIN authentication
 * 2. key export — AES-256-GCM encrypted file for manual transfer
 * 3. key ssh    — Automated SCP transfer via SSH
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { SWARM_KEY_PATH, IPFS_SWARM_KEY, CONFIG_DIR, KEY_SERVE_TIMEOUT } from '../utils/constants.js';
import { execSafe } from '../utils/exec.js';
import { log } from '../utils/logger.js';

/**
 * Generate a new swarm key using cryptographically secure random bytes.
 */
export function generateSwarmKey(outputPath?: string): string {
    const keyPath = outputPath ?? SWARM_KEY_PATH;

    if (fs.existsSync(keyPath)) {
        log.warn('Swarm key already exists, use --force to regenerate');
        return keyPath;
    }

    const keyHex = crypto.randomBytes(32).toString('hex');
    const keyContent = `/key/swarm/psk/1.0.0/\n/base16/\n${keyHex}`;

    fs.writeFileSync(keyPath, keyContent, { mode: 0o600 });
    log.success(`Swarm key generated: ${keyPath}`);
    return keyPath;
}

/**
 * Force-regenerate the swarm key (e.g., if compromised).
 */
export function regenerateSwarmKey(): string {
    if (fs.existsSync(SWARM_KEY_PATH)) {
        // Backup old key
        const backupPath = SWARM_KEY_PATH + '.old.' + Date.now();
        fs.copyFileSync(SWARM_KEY_PATH, backupPath);
        fs.chmodSync(backupPath, 0o600);
        log.dim(`Old key backed up to ${backupPath}`);
        fs.unlinkSync(SWARM_KEY_PATH);
    }
    return generateSwarmKey();
}

/**
 * Install the swarm key into the IPFS directory.
 */
export function installSwarmKey(swarmKeyPath?: string): void {
    const keyPath = swarmKeyPath ?? SWARM_KEY_PATH;

    if (!fs.existsSync(keyPath)) {
        throw new Error(`Swarm key not found at ${keyPath}`);
    }

    // Validate the key format
    const content = fs.readFileSync(keyPath, 'utf8');
    validateSwarmKeyFormat(content);

    // Ensure IPFS directory exists
    const ipfsDir = path.dirname(IPFS_SWARM_KEY);
    if (!fs.existsSync(ipfsDir)) {
        throw new Error(`IPFS directory not found at ${ipfsDir}. Run 'ipfs init' first.`);
    }

    fs.copyFileSync(keyPath, IPFS_SWARM_KEY);
    fs.chmodSync(IPFS_SWARM_KEY, 0o600);
    log.success('Swarm key installed to IPFS directory');
}

/**
 * Read and return the current swarm key content.
 */
export function readSwarmKey(): string | null {
    const keyPath = fs.existsSync(SWARM_KEY_PATH) ? SWARM_KEY_PATH :
        fs.existsSync(IPFS_SWARM_KEY) ? IPFS_SWARM_KEY : null;

    if (!keyPath) return null;
    return fs.readFileSync(keyPath, 'utf8');
}

/**
 * Validate swarm key file format.
 */
function validateSwarmKeyFormat(content: string): void {
    const lines = content.trim().split('\n');
    if (lines.length < 3) {
        throw new Error('Invalid swarm key: must have at least 3 lines');
    }
    if (!lines[0].startsWith('/key/swarm/psk/')) {
        throw new Error('Invalid swarm key: missing /key/swarm/psk/ header');
    }
    if (!lines[1].startsWith('/base16/')) {
        throw new Error('Invalid swarm key: missing /base16/ encoding line');
    }
    if (!/^[0-9a-f]{64}$/i.test(lines[2].trim())) {
        throw new Error('Invalid swarm key: hex key must be 64 characters');
    }
}

/* ─── Encrypted Export/Import ─── */

/**
 * Export swarm key encrypted with AES-256-GCM.
 */
export function exportKeyEncrypted(passphrase: string, outputPath?: string): string {
    const keyContent = readSwarmKey();
    if (!keyContent) throw new Error('No swarm key found to export');

    // Derive key from passphrase with PBKDF2
    const salt = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const derivedKey = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha512');

    // Encrypt
    const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
    let encrypted = cipher.update(keyContent, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // Pack: salt(32) + iv(16) + authTag(16) + ciphertext
    const packed = Buffer.concat([
        salt,
        iv,
        authTag,
        Buffer.from(encrypted, 'hex'),
    ]);

    const outPath = outputPath ?? path.join(CONFIG_DIR, 'swarm.key.enc');
    fs.writeFileSync(outPath, packed, { mode: 0o600 });
    log.success(`Encrypted key exported to ${outPath}`);
    return outPath;
}

/**
 * Import and decrypt an encrypted swarm key.
 */
export function importKeyEncrypted(encryptedPath: string, passphrase: string): void {
    if (!fs.existsSync(encryptedPath)) {
        throw new Error(`Encrypted key file not found: ${encryptedPath}`);
    }

    const packed = fs.readFileSync(encryptedPath);

    if (packed.length < 64) {
        throw new Error('Encrypted key file is too small to be valid');
    }

    // Unpack: salt(32) + iv(16) + authTag(16) + ciphertext
    const salt = packed.subarray(0, 32);
    const iv = packed.subarray(32, 48);
    const authTag = packed.subarray(48, 64);
    const ciphertext = packed.subarray(64);

    // Derive key
    const derivedKey = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha512');

    // Decrypt
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(ciphertext.toString('hex'), 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        // Validate decrypted content
        validateSwarmKeyFormat(decrypted);

        // Save decrypted key
        fs.writeFileSync(SWARM_KEY_PATH, decrypted, { mode: 0o600 });
        log.success('Swarm key decrypted and saved');
    } catch (error: any) {
        if (error.message.includes('Unsupported state')) {
            throw new Error('Decryption failed — wrong passphrase');
        }
        throw error;
    }
}

/* ─── One-Time Key Serve ─── */

/**
 * Start a one-time HTTP(S) server to securely share the swarm key.
 * Server auto-destroys after one successful transfer or timeout.
 * 
 * If useTLS is true, generates a self-signed certificate for encrypted transfer.
 */
export function serveKey(port = 8899, useTLS = false): Promise<{ pin: string; url: string }> {
    return new Promise(async (resolve, reject) => {
        const keyContent = readSwarmKey();
        if (!keyContent) {
            reject(new Error('No swarm key found to serve'));
            return;
        }

        // Generate 6-digit PIN
        const pin = crypto.randomInt(100_000, 999_999).toString();
        let transferred = false;

        const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
            // CORS headers for web fetch
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', 'X-Pin');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            // Require PIN in header
            const providedPin = req.headers['x-pin'] as string;
            if (providedPin !== pin) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid PIN' }));
                log.warn('Key request with invalid PIN rejected');
                return;
            }

            // Serve the key
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(keyContent);
            transferred = true;

            log.success('Swarm key transferred successfully!');

            // Auto-destroy server
            setTimeout(() => {
                server.close();
            }, 500);
        };

        let server: http.Server;
        let protocol: string;

        if (useTLS) {
            // Generate self-signed certificate for encrypted transfer
            try {
                const https = await import('node:https');
                const { privateKey, certificate } = generateSelfSignedCert();
                server = https.createServer({ key: privateKey, cert: certificate }, handler);
                protocol = 'https';
            } catch (e: any) {
                log.warn(`TLS setup failed, falling back to HTTP: ${e.message}`);
                server = http.createServer(handler);
                protocol = 'http';
            }
        } else {
            server = http.createServer(handler);
            protocol = 'http';
        }

        // Timeout auto-destroy
        const timeout = setTimeout(() => {
            if (!transferred) {
                log.warn('Key serve timed out — no transfer completed');
                server.close();
            }
        }, KEY_SERVE_TIMEOUT);

        server.on('close', () => {
            clearTimeout(timeout);
        });

        server.listen(port, '0.0.0.0', () => {
            if (protocol === 'http') {
                log.warn('⚠ Key is served over HTTP (unencrypted). Use --tls for encrypted transfer.');
            }
            resolve({ pin, url: `${protocol}://0.0.0.0:${port}` });
        });

        server.on('error', (err) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to start key server: ${err.message}`));
        });
    });
}

/**
 * Generate a self-signed certificate for the key server.
 */
function generateSelfSignedCert(): { privateKey: string; certificate: string } {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    // Use openssl to generate a self-signed cert
    const tmpKeyFile = path.join(CONFIG_DIR, '.tmp-key.pem');
    const tmpCertFile = path.join(CONFIG_DIR, '.tmp-cert.pem');

    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    fs.writeFileSync(tmpKeyFile, keyPem, { mode: 0o600 });

    const result = execSafe('openssl', [
        'req', '-new', '-x509',
        '-key', tmpKeyFile,
        '-out', tmpCertFile,
        '-days', '1',
        '-subj', '/CN=ipfs-swarm-key-server',
        '-batch',
    ]);

    if (!result.success) {
        try { fs.unlinkSync(tmpKeyFile); } catch { /* */ }
        throw new Error('Failed to generate self-signed certificate');
    }

    const certPem = fs.readFileSync(tmpCertFile, 'utf8');

    // Cleanup temp files
    try { fs.unlinkSync(tmpKeyFile); } catch { /* */ }
    try { fs.unlinkSync(tmpCertFile); } catch { /* */ }

    return { privateKey: keyPem, certificate: certPem };
}

/**
 * Fetch swarm key from a remote key server.
 */
export async function fetchKey(host: string, port: number, pin: string): Promise<void> {
    const url = `http://${host}:${port}`;

    log.info(`Fetching swarm key from ${url}...`);

    try {
        const response = await fetch(url, {
            headers: { 'X-Pin': pin },
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Server returned ${response.status}: ${body}`);
        }

        const keyContent = await response.text();
        validateSwarmKeyFormat(keyContent);

        fs.writeFileSync(SWARM_KEY_PATH, keyContent, { mode: 0o600 });
        log.success('Swarm key fetched and saved');
    } catch (error: any) {
        throw new Error(`Failed to fetch key: ${error.message}`);
    }
}

/* ─── SSH Transfer ─── */

/**
 * Copy swarm key to a remote host via SCP.
 */
export async function copyKeyViaSSH(target: string): Promise<void> {
    const keyContent = readSwarmKey();
    if (!keyContent) throw new Error('No swarm key found to copy');

    // target format: user@host or user@host:/path
    const [hostPart, remotePath] = target.split(':');
    const remoteKeyPath = remotePath ?? '~/.ipfs-swarm/swarm.key';

    log.info(`Copying swarm key to ${hostPart}:${remoteKeyPath}...`);

    // Ensure remote directory exists
    const mkdirResult = execSafe('ssh', [hostPart, 'mkdir', '-p', path.dirname(remoteKeyPath)]);
    if (!mkdirResult.success) {
        throw new Error(`Failed to create remote directory: ${mkdirResult.stderr}`);
    }

    // SCP transfer
    const scpResult = execSafe('scp', ['-q', SWARM_KEY_PATH, `${hostPart}:${remoteKeyPath}`]);
    if (!scpResult.success) {
        throw new Error(`SCP failed: ${scpResult.stderr}`);
    }

    // Set permissions on remote
    execSafe('ssh', [hostPart, 'chmod', '600', remoteKeyPath]);

    log.success(`Swarm key copied to ${hostPart}:${remoteKeyPath}`);
}
