/**
 * Kubo (go-ipfs) installation and detection service.
 * 
 * Handles cross-platform Kubo installation with proper architecture
 * detection and PATH-based discovery instead of hardcoded paths.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KUBO_VERSION, KUBO_DOWNLOAD_BASE, ARCH_MAP, PLATFORM_MAP, IPFS_DIR } from '../utils/constants.js';
import { execSafe, execLive, commandExists, findCommand } from '../utils/exec.js';
import { log } from '../utils/logger.js';
import { updateConfig } from './config.js';

export interface KuboInfo {
    path: string;
    version: string;
    initialized: boolean;
}

/**
 * Detect if Kubo is installed and return its details.
 */
export function detectKubo(): KuboInfo | null {
    // Try PATH first (works on all platforms and package managers)
    const ipfsPath = findCommand('ipfs');
    if (!ipfsPath) return null;

    const result = execSafe(ipfsPath, ['version']);
    if (!result.success) return null;

    const versionMatch = result.stdout.match(/(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';

    const configPath = path.join(os.homedir(), '.ipfs', 'config');
    const initialized = fs.existsSync(configPath);

    return { path: ipfsPath, version, initialized };
}

/**
 * Get the platform-specific download URL for Kubo.
 */
function getKuboDownloadUrl(): { url: string; filename: string } {
    const arch = ARCH_MAP[os.arch()] ?? 'amd64';
    const platform = PLATFORM_MAP[os.platform()] ?? 'linux';
    const ext = platform === 'windows' ? 'zip' : 'tar.gz';
    const filename = `kubo_v${KUBO_VERSION}_${platform}-${arch}.${ext}`;
    const url = `${KUBO_DOWNLOAD_BASE}/v${KUBO_VERSION}/${filename}`;
    return { url, filename };
}

/**
 * Install Kubo on the system.
 */
export async function installKubo(): Promise<string> {
    const existing = detectKubo();
    if (existing) {
        log.success(`Kubo v${existing.version} already installed at ${existing.path}`);
        updateConfig({ kuboPath: existing.path });
        return existing.path;
    }

    const { url, filename } = getKuboDownloadUrl();
    const tmpDir = os.tmpdir();
    const downloadPath = path.join(tmpDir, filename);

    log.info(`Downloading Kubo v${KUBO_VERSION}...`);

    // Download
    const dlResult = await execLive('curl', [
        '-L', '--progress-bar',
        '-o', downloadPath,
        '--fail',
        '--retry', '3',
        '--retry-delay', '2',
        url,
    ]);

    if (!dlResult.success) {
        throw new Error(`Failed to download Kubo: ${dlResult.stderr}`);
    }

    // Extract
    log.info('Extracting...');
    const extractResult = await execLive('tar', ['-xzf', downloadPath, '-C', tmpDir]);
    if (!extractResult.success) {
        throw new Error(`Failed to extract Kubo: ${extractResult.stderr}`);
    }

    // Install
    const extractedBinary = path.join(tmpDir, 'kubo', 'ipfs');
    let installPath: string;

    // Try /usr/local/bin first, fall back to ~/.local/bin
    const localBin = path.join(os.homedir(), '.local', 'bin');
    const systemBin = '/usr/local/bin';

    // Check if we need sudo for system-wide install
    const canWriteSystem = (() => {
        try {
            fs.accessSync(systemBin, fs.constants.W_OK);
            return true;
        } catch {
            return false;
        }
    })();

    if (canWriteSystem) {
        installPath = path.join(systemBin, 'ipfs');
        const cpResult = await execLive('cp', [extractedBinary, installPath]);
        if (!cpResult.success) throw new Error('Failed to copy ipfs binary');
        await execLive('chmod', ['+x', installPath]);
    } else {
        // Try with sudo
        const sudoResult = await execLive('sudo', ['cp', extractedBinary, path.join(systemBin, 'ipfs')]);
        if (sudoResult.success) {
            installPath = path.join(systemBin, 'ipfs');
            await execLive('sudo', ['chmod', '+x', installPath]);
        } else {
            // Fall back to user-local install
            if (!fs.existsSync(localBin)) {
                fs.mkdirSync(localBin, { recursive: true });
            }
            installPath = path.join(localBin, 'ipfs');
            fs.copyFileSync(extractedBinary, installPath);
            fs.chmodSync(installPath, 0o755);
            log.warn(`Installed to ${installPath} — ensure ${localBin} is in your PATH`);
        }
    }

    // Cleanup
    try {
        fs.rmSync(downloadPath, { force: true });
        fs.rmSync(path.join(tmpDir, 'kubo'), { recursive: true, force: true });
    } catch { /* cleanup failures are non-fatal */ }

    // Verify installation
    const verifyResult = execSafe(installPath, ['version']);
    if (!verifyResult.success) {
        throw new Error('Kubo installation verification failed');
    }

    log.success(`Kubo v${KUBO_VERSION} installed at ${installPath}`);
    updateConfig({ kuboPath: installPath });
    return installPath;
}

/**
 * Initialize IPFS repository if not already done.
 */
export async function initializeIpfs(kuboPath?: string): Promise<void> {
    const ipfs = kuboPath ?? findCommand('ipfs');
    if (!ipfs) throw new Error('Kubo not found. Run `ipfs-swarm init` first.');

    const configPath = path.join(IPFS_DIR, 'config');
    if (fs.existsSync(configPath)) {
        log.success('IPFS repository already initialized');
        return;
    }

    log.info('Initializing IPFS repository...');
    const result = await execLive(ipfs, ['init', '--profile=server']);
    if (!result.success) {
        throw new Error(`Failed to initialize IPFS: ${result.stderr}`);
    }

    log.success('IPFS repository initialized');
}

/**
 * Configure IPFS for private swarm operation.
 */
export async function configureIpfsForPrivateSwarm(
    kuboPath: string,
    options: {
        swarmPort: number;
        apiPort: number;
        gatewayPort: number;
        bootstrapMultiaddr?: string | null;
    }
): Promise<void> {
    const ipfs = kuboPath;

    log.info('Configuring IPFS for private swarm...');

    // Disable MDNS discovery (not needed in private networks)
    await execLive(ipfs, ['config', '--bool', 'Discovery.MDNS.Enabled', 'false'], { silent: true });

    // Set DHT routing
    await execLive(ipfs, ['config', 'Routing.Type', 'dht'], { silent: true });

    // Disable AutoTLS (private network, no public certificates needed)
    await execLive(ipfs, ['config', '--json', 'AutoTLS', '{"Enabled":false}'], { silent: true });

    // Connection manager limits
    await execLive(ipfs, ['config', '--json', 'Swarm.ConnMgr', '{"LowWater":10,"HighWater":100}'], { silent: true });

    // Set addresses
    const swarmAddresses = JSON.stringify([
        `/ip4/0.0.0.0/tcp/${options.swarmPort}`,
        `/ip6/::/tcp/${options.swarmPort}`,
    ]);
    await execLive(ipfs, ['config', '--json', 'Addresses.Swarm', swarmAddresses], { silent: true });
    await execLive(ipfs, ['config', 'Addresses.API', `/ip4/127.0.0.1/tcp/${options.apiPort}`], { silent: true });
    await execLive(ipfs, ['config', 'Addresses.Gateway', `/ip4/127.0.0.1/tcp/${options.gatewayPort}`], { silent: true });

    // Clear default public bootstrap nodes
    await execLive(ipfs, ['bootstrap', 'rm', '--all'], { silent: true });

    // Add custom bootstrap if this is a regular node
    if (options.bootstrapMultiaddr) {
        await execLive(ipfs, ['bootstrap', 'add', options.bootstrapMultiaddr], { silent: true });
    }

    log.success('IPFS configured for private swarm');
}

/**
 * Get required system tools and check availability.
 */
export function checkSystemTools(): { available: string[]; missing: string[] } {
    const tools = ['curl', 'tar', 'openssl'];
    const available: string[] = [];
    const missing: string[] = [];

    for (const tool of tools) {
        if (commandExists(tool)) {
            available.push(tool);
        } else {
            missing.push(tool);
        }
    }

    return { available, missing };
}
