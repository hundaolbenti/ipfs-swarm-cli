/**
 * Network utilities — IP detection, Tailscale integration, port checking.
 */
import { execSafe } from '../utils/exec.js';
import { log } from '../utils/logger.js';
import { loadConfig, updateConfig } from './config.js';
import net from 'node:net';
import os from 'node:os';

/**
 * Detect the external/public IP address.
 */
export async function getExternalIP(): Promise<string | null> {
    // Try multiple services for reliability
    const services = [
        'https://api.ipify.org',
        'https://ifconfig.me/ip',
        'https://icanhazip.com',
    ];

    for (const url of services) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(5000),
            });
            if (response.ok) {
                const ip = (await response.text()).trim();
                if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
                    return ip;
                }
            }
        } catch { /* try next */ }
    }
    return null;
}

/**
 * Get the local/private IP address.
 * Uses os.networkInterfaces() for cross-platform compatibility (#17).
 */
export function getLocalIP(): string | null {
    const interfaces = os.networkInterfaces();

    for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue;

        for (const addr of addrs) {
            // Skip loopback, IPv6, and Docker/container interfaces
            if (
                addr.internal ||
                addr.family !== 'IPv4' ||
                addr.address.startsWith('172.17.') ||
                addr.address.startsWith('169.254.')
            ) continue;

            return addr.address;
        }
    }

    // Fallback to hostname -I (Linux only)
    const result = execSafe('hostname', ['-I']);
    if (result.success) {
        const ips = result.stdout.trim().split(/\s+/);
        return ips.find(ip =>
            !ip.startsWith('127.') &&
            !ip.startsWith('172.17.') &&
            !ip.startsWith('169.254.')
        ) ?? ips[0] ?? null;
    }

    return null;
}

/* ─── Tailscale Integration ─── */

export interface TailscaleStatus {
    installed: boolean;
    running: boolean;
    ip: string | null;
    hostname: string | null;
    magicDNS: boolean;
    peers: TailscalePeer[];
}

export interface TailscalePeer {
    hostname: string;
    ip: string;
    online: boolean;
}

/**
 * Detect Tailscale status and network information.
 */
export function detectTailscale(): TailscaleStatus {
    const noTailscale: TailscaleStatus = {
        installed: false,
        running: false,
        ip: null,
        hostname: null,
        magicDNS: false,
        peers: [],
    };

    // Check if tailscale is installed
    const tsResult = execSafe('tailscale', ['version']);
    if (!tsResult.success) return noTailscale;

    // Get status JSON
    const statusResult = execSafe('tailscale', ['status', '--json']);
    if (!statusResult.success) {
        return { ...noTailscale, installed: true };
    }

    try {
        const status = JSON.parse(statusResult.stdout);

        const selfData = status.Self;
        const ip = selfData?.TailscaleIPs?.[0] ?? null;
        const hostname = selfData?.HostName ?? null;
        const magicDNS = status.MagicDNSSuffix ? true : false;

        // Collect peers
        const peers: TailscalePeer[] = [];
        if (status.Peer) {
            for (const [, peerData] of Object.entries(status.Peer) as any[]) {
                peers.push({
                    hostname: peerData.HostName,
                    ip: peerData.TailscaleIPs?.[0] ?? '',
                    online: peerData.Online ?? false,
                });
            }
        }

        return {
            installed: true,
            running: true,
            ip,
            hostname,
            magicDNS,
            peers,
        };
    } catch {
        return { ...noTailscale, installed: true };
    }
}

/**
 * Build multiaddr using the best available IP.
 * Priority: Tailscale IP > Local IP > External IP
 */
export async function buildMultiaddr(peerId: string, port: number): Promise<{
    local: string;
    tailscale: string | null;
    external: string | null;
}> {
    const localIP = getLocalIP() ?? '127.0.0.1';
    const local = `/ip4/${localIP}/tcp/${port}/p2p/${peerId}`;

    let tailscale: string | null = null;
    const ts = detectTailscale();
    if (ts.running && ts.ip) {
        tailscale = `/ip4/${ts.ip}/tcp/${port}/p2p/${peerId}`;
        updateConfig({ tailscaleIP: ts.ip, networkType: 'tailscale' });
    }

    let external: string | null = null;
    const extIP = await getExternalIP();
    if (extIP) {
        external = `/ip4/${extIP}/tcp/${port}/p2p/${peerId}`;
    }

    return { local, tailscale, external };
}

/**
 * Check if a port is available for binding.
 */
export function isPortAvailable(port: number, host = '0.0.0.0'): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, host);
    });
}

/**
 * Find the next available port starting from a given port.
 */
export async function findAvailablePort(startPort: number): Promise<number> {
    for (let port = startPort; port < startPort + 100; port++) {
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    throw new Error(`No available port found in range ${startPort}-${startPort + 99}`);
}

/**
 * Test connectivity to a remote multiaddr.
 */
export async function testConnectivity(host: string, port: number, timeout = 5000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port, timeout });
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('error', () => resolve(false));
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
    });
}

/**
 * Display a comprehensive network status summary.
 */
export async function printNetworkStatus(peerId: string, port: number): Promise<void> {
    const addrs = await buildMultiaddr(peerId, port);

    log.section('Network Addresses');
    log.kv('Local', addrs.local);

    if (addrs.tailscale) {
        log.kv('Tailscale', addrs.tailscale);
    }

    if (addrs.external) {
        log.kv('External', addrs.external);
    }

    // Tailscale details
    const ts = detectTailscale();
    if (ts.installed) {
        log.section('Tailscale');
        log.kv('Status', ts.running ? '🟢 Connected' : '🔴 Not running');
        if (ts.hostname) log.kv('Hostname', ts.hostname);
        if (ts.magicDNS) log.kv('MagicDNS', '✔ Enabled');
        if (ts.peers.length > 0) {
            log.kv('Peers', `${ts.peers.filter(p => p.online).length}/${ts.peers.length} online`);
        }
    }
}
