/**
 * IPFS daemon lifecycle management.
 * 
 * Handles starting, stopping, and monitoring the IPFS daemon
 * with proper PID tracking, health checks, and lock files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LOCK_FILE, DAEMON_START_TIMEOUT, DAEMON_POLL_INTERVAL, CONFIG_DIR } from '../utils/constants.js';
import { execSafe, execDetached, getIpfsPath } from '../utils/exec.js';
import { log } from '../utils/logger.js';
import { loadConfig, updateConfig } from './config.js';

/**
 * Check if the IPFS daemon is currently running and responsive.
 */
export function isDaemonRunning(): boolean {
    const result = execSafe(getIpfsPath() ?? 'ipfs', ['swarm', 'peers'], { timeout: 5_000 });
    return result.success;
}

/**
 * Get the peer ID of this node.
 */
export function getPeerId(): string | null {
    const ipfs = getIpfsPath();
    if (!ipfs) return null;

    const result = execSafe(ipfs, ['id', '-f', '<id>']);
    return result.success ? result.stdout.trim() : null;
}

/**
 * Get full node identity info (ID, addresses, protocols, etc.).
 */
export function getNodeIdentity(): Record<string, any> | null {
    const ipfs = getIpfsPath();
    if (!ipfs) return null;

    const result = execSafe(ipfs, ['id']);
    if (!result.success) return null;

    try {
        return JSON.parse(result.stdout);
    } catch {
        return null;
    }
}

/**
 * Get list of connected swarm peers.
 */
export function getSwarmPeers(): string[] {
    const ipfs = getIpfsPath();
    if (!ipfs) return [];

    const result = execSafe(ipfs, ['swarm', 'peers']);
    if (!result.success) return [];

    return result.stdout.trim().split('\n').filter(Boolean);
}

/**
 * Acquire a lock file to prevent concurrent operations.
 */
function acquireLock(): boolean {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            // Check if the PID in the lock file is still running
            const lockContent = fs.readFileSync(LOCK_FILE, 'utf8').trim();
            const pid = parseInt(lockContent, 10);

            if (!isNaN(pid)) {
                try {
                    process.kill(pid, 0); // Check if process exists
                    return false; // Process still running, lock is valid
                } catch {
                    // Process no longer exists, stale lock
                    fs.unlinkSync(LOCK_FILE);
                }
            } else {
                fs.unlinkSync(LOCK_FILE);
            }
        }

        fs.writeFileSync(LOCK_FILE, process.pid.toString(), { mode: 0o600 });
        return true;
    } catch {
        return false;
    }
}

/**
 * Release the lock file.
 */
function releaseLock(): void {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const content = fs.readFileSync(LOCK_FILE, 'utf8').trim();
            if (content === process.pid.toString()) {
                fs.unlinkSync(LOCK_FILE);
            }
        }
    } catch { /* cleanup failures are non-fatal */ }
}

/**
 * Wait for the daemon to become responsive.
 */
async function waitForDaemon(timeout = DAEMON_START_TIMEOUT): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        if (isDaemonRunning()) return true;
        await new Promise(r => setTimeout(r, DAEMON_POLL_INTERVAL));
        process.stdout.write('.');
    }

    console.log('');
    return false;
}

/**
 * Start the IPFS daemon.
 */
export async function startDaemon(): Promise<boolean> {
    if (isDaemonRunning()) {
        log.warn('IPFS daemon is already running');
        return true;
    }

    if (!acquireLock()) {
        log.error('Another ipfs-swarm operation is in progress (lock file exists)');
        return false;
    }

    try {
        const ipfs = getIpfsPath();
        if (!ipfs) {
            throw new Error('Kubo not found. Run `ipfs-swarm init` first.');
        }

        const config = loadConfig();
        log.info(`Starting ${config.nodeType} node...`);

        // Set environment for private network enforcement
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            LIBP2P_FORCE_PNET: '1',
        };

        // Support custom IPFS repo path
        if (config.ipfsPath) {
            env.IPFS_PATH = config.ipfsPath;
        }

        // Spawn detached daemon WITH the env (fixes #1)
        const child = execDetached(ipfs, ['daemon'], { env });

        // Store daemon PID for later management
        const pidFile = path.join(CONFIG_DIR, 'daemon.pid');
        if (child.pid) {
            fs.writeFileSync(pidFile, child.pid.toString(), { mode: 0o600 });
        }

        // Log daemon output
        const logFile = path.join(CONFIG_DIR, 'logs', `daemon-${Date.now()}.log`);
        const logStream = fs.createWriteStream(logFile, { flags: 'a' });
        child.stdout?.pipe(logStream);
        child.stderr?.pipe(logStream);

        // Wait for daemon to be ready
        log.info('Waiting for daemon to start');
        const started = await waitForDaemon();

        if (!started) {
            log.error('Daemon failed to start within timeout');
            await stopDaemon();
            return false;
        }

        // Update config with node info
        const peerId = getPeerId();
        if (peerId) {
            updateConfig({
                nodeId: peerId,
                lastStarted: new Date().toISOString(),
            });
        }

        log.success('IPFS daemon started successfully');
        return true;
    } finally {
        releaseLock();
    }
}

/**
 * Stop the IPFS daemon gracefully.
 */
export async function stopDaemon(): Promise<void> {
    // Try graceful shutdown via IPFS API
    const ipfs = getIpfsPath();
    if (ipfs) {
        const result = execSafe(ipfs, ['shutdown'], { timeout: 10_000 });
        if (result.success) {
            log.success('IPFS daemon stopped');
            return;
        }
    }

    // Try killing by PID file
    const pidFile = path.join(CONFIG_DIR, 'daemon.pid');
    if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (!isNaN(pid)) {
            try {
                process.kill(pid, 'SIGTERM');
                await new Promise(r => setTimeout(r, 2000));
                try {
                    process.kill(pid, 0); // Check if still running
                    process.kill(pid, 'SIGKILL'); // Force kill
                } catch { /* already dead */ }
            } catch { /* process doesn't exist */ }
        }
        try { fs.unlinkSync(pidFile); } catch { /* */ }
    }

    // Last resort: pkill with exact match
    if (process.platform !== 'win32') {
        execSafe('pkill', ['-x', 'ipfs']); // -x = exact match only
    }

    await new Promise(r => setTimeout(r, 1000));
    log.success('IPFS daemon stopped');
}

/**
 * Get bandwidth stats from the daemon.
 */
export function getBandwidthStats(): Record<string, any> | null {
    const ipfs = getIpfsPath();
    if (!ipfs) return null;

    const result = execSafe(ipfs, ['stats', 'bw']);
    if (!result.success) return null;

    const stats: Record<string, string> = {};
    for (const line of result.stdout.split('\n')) {
        const match = line.match(/^(\w+):\s+(.+)$/);
        if (match) {
            stats[match[1]] = match[2].trim();
        }
    }
    return stats;
}

/**
 * Get IPFS repo stats (storage usage).
 */
export function getRepoStats(): Record<string, any> | null {
    const ipfs = getIpfsPath();
    if (!ipfs) return null;

    const result = execSafe(ipfs, ['repo', 'stat', '--human']);
    if (!result.success) return null;

    const stats: Record<string, string> = {};
    for (const line of result.stdout.split('\n')) {
        const match = line.match(/^(\w[\w\s]+):\s+(.+)$/);
        if (match) {
            stats[match[1].trim()] = match[2].trim();
        }
    }
    return stats;
}
