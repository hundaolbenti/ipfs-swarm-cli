/**
 * Configuration management with schema validation and versioned migration.
 * 
 * Config is stored at ~/.ipfs-swarm/config.json with a version field
 * to support seamless upgrades when the config schema changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, CONFIG_PATH, CONFIG_VERSION, DEFAULT_SWARM_PORT, LOG_DIR } from '../utils/constants.js';
import { log } from '../utils/logger.js';
import { validatePort } from '../utils/validator.js';

export type NodeType = 'bootstrap' | 'regular';
export type NetworkType = 'local' | 'tailscale' | 'public';

export interface SwarmConfig {
    version: number;
    nodeType: NodeType;
    networkType: NetworkType;
    swarmKey: string | null;
    basePort: number;
    apiPort: number;
    gatewayPort: number;
    bootstrapMultiaddr: string | null;
    bootstrapPeers: string[];
    nodeId: string | null;
    lastStarted: string | null;
    tailscaleIP: string | null;
    kuboPath: string | null;
    ipfsPath: string | null;
    autoStart: boolean;
    encryption: {
        enabled: boolean;
        algorithm: string;
    };
}

const DEFAULT_CONFIG: SwarmConfig = {
    version: CONFIG_VERSION,
    nodeType: 'bootstrap',
    networkType: 'local',
    swarmKey: null,
    basePort: DEFAULT_SWARM_PORT,
    apiPort: 5001,
    gatewayPort: 8080,
    bootstrapMultiaddr: null,
    bootstrapPeers: [],
    nodeId: null,
    lastStarted: null,
    tailscaleIP: null,
    kuboPath: null,
    ipfsPath: null,
    autoStart: false,
    encryption: {
        enabled: false,
        algorithm: 'aes-256-gcm',
    },
};

/**
 * Ensure config directory exists.
 */
function ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    }
}

/**
 * Migrate old config versions to the current schema.
 */
function migrateConfig(raw: Record<string, any>): SwarmConfig {
    const version = raw.version ?? 1;

    // v1 → v2: add new fields
    if (version < 2) {
        log.info('Migrating config from v1 to v2...');
        raw.version = 2;
        raw.apiPort = raw.apiPort ?? (raw.basePort ? raw.basePort + 1000 : 5001);
        raw.gatewayPort = raw.gatewayPort ?? (raw.basePort ? raw.basePort + 4080 : 8080);
        raw.bootstrapPeers = raw.bootstrapPeers ?? [];
        raw.autoStart = raw.autoStart ?? false;
        raw.encryption = raw.encryption ?? { enabled: false, algorithm: 'aes-256-gcm' };
        raw.kuboPath = raw.kuboPath ?? null;
    }

    // Merge with defaults to fill any missing fields
    return { ...DEFAULT_CONFIG, ...raw } as SwarmConfig;
}

/**
 * Load configuration from disk. Creates default if missing.
 */
export function loadConfig(): SwarmConfig {
    ensureConfigDir();

    if (!fs.existsSync(CONFIG_PATH)) {
        saveConfig(DEFAULT_CONFIG);
        return { ...DEFAULT_CONFIG };
    }

    try {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        const config = migrateConfig(raw);

        // Save migrated config if version changed
        if (raw.version !== config.version) {
            saveConfig(config);
        }

        return config;
    } catch (error) {
        log.warn('Config file corrupted, creating backup and resetting...');
        const backupPath = CONFIG_PATH + '.bak.' + Date.now();
        fs.copyFileSync(CONFIG_PATH, backupPath);
        log.dim(`Backup saved to ${backupPath}`);
        saveConfig(DEFAULT_CONFIG);
        return { ...DEFAULT_CONFIG };
    }
}

/**
 * Save configuration to disk with restrictive permissions.
 */
export function saveConfig(config: SwarmConfig): void {
    ensureConfigDir();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/**
 * Update specific fields in the configuration.
 */
export function updateConfig(updates: Partial<SwarmConfig>): SwarmConfig {
    const config = loadConfig();
    const updated = { ...config, ...updates };
    saveConfig(updated);
    return updated;
}

/**
 * Validate and normalize port configuration.
 */
export function validatePorts(config: SwarmConfig): void {
    validatePort(config.basePort);
    validatePort(config.apiPort);
    validatePort(config.gatewayPort);

    const ports = [config.basePort, config.apiPort, config.gatewayPort];
    const unique = new Set(ports);
    if (unique.size !== ports.length) {
        throw new Error('Swarm, API, and Gateway ports must all be different');
    }
}
