/**
 * Constants and defaults used throughout the CLI.
 */
import path from 'node:path';
import os from 'node:os';

export const APP_NAME = 'ipfs-swarm-cli';
export const APP_VERSION = '2.0.0';
export const KUBO_VERSION = '0.35.0';

/* ─── Directories ─── */
export const HOME_DIR = os.homedir();
export const CONFIG_DIR = path.join(HOME_DIR, '.ipfs-swarm');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
export const SWARM_KEY_PATH = path.join(CONFIG_DIR, 'swarm.key');
export const LOG_DIR = path.join(CONFIG_DIR, 'logs');
export const LOCK_FILE = path.join(CONFIG_DIR, '.lock');
export const IPFS_DIR = path.join(HOME_DIR, '.ipfs');
export const IPFS_SWARM_KEY = path.join(IPFS_DIR, 'swarm.key');

/* ─── Networking ─── */
export const DEFAULT_SWARM_PORT = 4001;
export const DEFAULT_API_PORT = 5001;
export const DEFAULT_GATEWAY_PORT = 8080;
export const DEFAULT_WEB_PORT = 9876;
export const MIN_PORT = 1025;
export const MAX_PORT = 65534;

/* ─── Kubo Download ─── */
export const KUBO_DOWNLOAD_BASE = 'https://github.com/ipfs/kubo/releases/download';

/* ─── Architecture Map ─── */
export const ARCH_MAP: Record<string, string> = {
    arm64: 'arm64',
    x64: 'amd64',
    arm: 'arm',
    ia32: '386',
};

export const PLATFORM_MAP: Record<string, string> = {
    linux: 'linux',
    darwin: 'darwin',
    win32: 'windows',
    freebsd: 'freebsd',
};

/* ─── Connection Timeouts ─── */
export const DAEMON_START_TIMEOUT = 20_000;
export const DAEMON_POLL_INTERVAL = 1_000;
export const KEY_SERVE_TIMEOUT = 300_000; // 5 minutes
export const DOWNLOAD_TIMEOUT = 120_000;

/* ─── Config Schema Version ─── */
export const CONFIG_VERSION = 2;
