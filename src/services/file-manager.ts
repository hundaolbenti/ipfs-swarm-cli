/**
 * IPFS file management service.
 * 
 * Wraps the Kubo HTTP API for file operations with progress tracking,
 * metadata handling, and MFS (Mutable File System) support.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSafe, getIpfsPath } from '../utils/exec.js';
import { log } from '../utils/logger.js';
import { validateCID, validatePath } from '../utils/validator.js';

export interface FileInfo {
    cid: string;
    name: string;
    size: number;
    type: 'file' | 'directory';
    pinned: boolean;
}

export interface PinInfo {
    cid: string;
    type: string;
}

/**
 * Add a file or directory to IPFS.
 */
export async function addFile(filePath: string): Promise<{ cid: string; size: number }> {
    const validPath = validatePath(filePath);
    const ipfs = getIpfsPath();
    if (!ipfs) throw new Error('IPFS not found');

    if (!fs.existsSync(validPath)) {
        throw new Error(`File not found: ${validPath}`);
    }

    const stat = fs.statSync(validPath);
    const isDir = stat.isDirectory();
    // Use non-quiet mode to get size from IPFS output
    const args = isDir
        ? ['add', '-r', '--pin=true', validPath]
        : ['add', '--pin=true', validPath];

    const result = execSafe(ipfs, args, { timeout: 300_000 }); // 5 min timeout for large files
    if (!result.success) {
        throw new Error(`Failed to add file: ${result.stderr}`);
    }

    // Parse IPFS output — format: "added <CID> <name> <size>" or "added <CID> <name>"
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    const lastLine = lines[lines.length - 1].trim();
    const addedMatch = lastLine.match(/^added\s+(\S+)\s+(\S+)(?:\s+(\S+))?/);

    let cid: string;
    let ipfsSize: number;

    if (addedMatch) {
        cid = addedMatch[1];
        // Try to get actual IPFS size from object stat
        const statResult = execSafe(ipfs, ['object', 'stat', cid], { timeout: 30_000 });
        const sizeMatch = statResult.stdout?.match(/CumulativeSize:\s*(\d+)/);
        ipfsSize = sizeMatch ? parseInt(sizeMatch[1], 10) : stat.size;
    } else {
        // Fallback: last word is probably the CID
        cid = lastLine.split(/\s+/).pop() ?? lastLine;
        ipfsSize = stat.size;
    }

    // Add to MFS — handle existing names by appending timestamp
    const mfsName = path.basename(validPath);
    const cpResult = execSafe(ipfs, ['files', 'cp', `/ipfs/${cid}`, `/${mfsName}`], { timeout: 30_000 });
    if (!cpResult.success && cpResult.stderr.includes('already has entry')) {
        const uniqueName = `${mfsName}_${Date.now()}`;
        execSafe(ipfs, ['files', 'cp', `/ipfs/${cid}`, `/${uniqueName}`], { timeout: 30_000 });
    }

    return { cid, size: ipfsSize };
}

/**
 * Retrieve a file from IPFS by CID.
 */
export async function getFile(cid: string, outputPath?: string): Promise<string> {
    const validCid = validateCID(cid);
    const ipfs = getIpfsPath();
    if (!ipfs) throw new Error('IPFS not found');

    const outPath = outputPath ?? path.join(process.cwd(), validCid);

    const result = execSafe(ipfs, ['get', '-o', outPath, validCid], { timeout: 300_000 });
    if (!result.success) {
        throw new Error(`Failed to get file: ${result.stderr}`);
    }

    return outPath;
}

/**
 * Download a file from IPFS to a temporary location.
 * Used for web downloads to preserve binary integrity.
 */
export async function getFileToTemp(cid: string): Promise<string> {
    const validCid = validateCID(cid);
    const ipfs = getIpfsPath();
    if (!ipfs) throw new Error('IPFS not found');

    const tmpDir = path.join(os.tmpdir(), 'ipfs-swarm-downloads');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    const outPath = path.join(tmpDir, validCid);

    // Clean up any previous download of the same CID
    if (fs.existsSync(outPath)) {
        fs.rmSync(outPath, { recursive: true, force: true });
    }

    const result = execSafe(ipfs, ['get', '-o', outPath, validCid], { timeout: 300_000 });
    if (!result.success) {
        throw new Error(`Failed to get file: ${result.stderr}`);
    }

    return outPath;
}

/**
 * Read file content from IPFS (like cat).
 */
export function catFile(cid: string): string {
    const validCid = validateCID(cid);
    const ipfs = getIpfsPath();
    if (!ipfs) throw new Error('IPFS not found');

    const result = execSafe(ipfs, ['cat', validCid], { timeout: 60_000 });
    if (!result.success) {
        throw new Error(`Failed to read file: ${result.stderr}`);
    }

    return result.stdout;
}

/**
 * Pin a CID to ensure it persists in the local node.
 */
export function pinFile(cid: string): void {
    const validCid = validateCID(cid);
    const ipfs = getIpfsPath();
    if (!ipfs) throw new Error('IPFS not found');

    const result = execSafe(ipfs, ['pin', 'add', validCid], { timeout: 120_000 });
    if (!result.success) {
        throw new Error(`Failed to pin: ${result.stderr}`);
    }

    log.success(`Pinned: ${validCid}`);
}

/**
 * Unpin a CID from the local node.
 */
export function unpinFile(cid: string): void {
    const validCid = validateCID(cid);
    const ipfs = getIpfsPath();
    if (!ipfs) throw new Error('IPFS not found');

    const result = execSafe(ipfs, ['pin', 'rm', validCid]);
    if (!result.success) {
        // Not an error if it wasn't pinned
        if (result.stderr.includes('not pinned')) {
            log.warn(`${validCid} was not pinned`);
            return;
        }
        throw new Error(`Failed to unpin: ${result.stderr}`);
    }

    log.success(`Unpinned: ${validCid}`);
}

/**
 * List all pinned CIDs.
 */
export function listPins(): PinInfo[] {
    const ipfs = getIpfsPath();
    if (!ipfs) throw new Error('IPFS not found');

    const result = execSafe(ipfs, ['pin', 'ls', '--type=recursive']);
    if (!result.success) return [];

    return result.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const parts = line.split(/\s+/);
            return { cid: parts[0], type: parts[1] ?? 'recursive' };
        });
}

/**
 * Get detailed information about a CID.
 */
export function getFileInfo(cid: string): FileInfo | null {
    const validCid = validateCID(cid);
    const ipfs = getIpfsPath();
    if (!ipfs) return null;

    // Get object stat
    const statResult = execSafe(ipfs, ['object', 'stat', validCid], { timeout: 30_000 });
    if (!statResult.success) return null;

    let size = 0;
    const sizeMatch = statResult.stdout.match(/CumulativeSize:\s*(\d+)/);
    if (sizeMatch) size = parseInt(sizeMatch[1], 10);

    // Check if it's a file or directory
    const lsResult = execSafe(ipfs, ['ls', validCid], { timeout: 30_000 });
    const isDir = lsResult.success && lsResult.stdout.trim().split('\n').length > 1;

    // Check if pinned
    const pinResult = execSafe(ipfs, ['pin', 'ls', '--type=recursive', validCid]);
    const pinned = pinResult.success && pinResult.stdout.includes(validCid);

    return {
        cid: validCid,
        name: validCid,
        size,
        type: isDir ? 'directory' : 'file',
        pinned,
    };
}

/**
 * List files in the MFS (Mutable File System) root.
 */
export function listMFS(mfsPath = '/'): { name: string; size: number; cid: string; type: string }[] {
    const ipfs = getIpfsPath();
    if (!ipfs) return [];

    const result = execSafe(ipfs, ['files', 'ls', '-l', mfsPath]);
    if (!result.success) return [];

    return result.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const parts = line.split(/\s+/);
            return {
                name: parts[0] ?? '',
                cid: parts[1] ?? '',
                size: parseInt(parts[2] ?? '0', 10),
                type: parts[0]?.endsWith('/') ? 'directory' : 'file',
            };
        });
}

/**
 * Remove a file from MFS.
 */
export function removeMFSFile(mfsPath: string): void {
    const ipfs = getIpfsPath();
    if (!ipfs) throw new Error('IPFS not found');

    const result = execSafe(ipfs, ['files', 'rm', '-r', mfsPath]);
    if (!result.success) {
        throw new Error(`Failed to remove from MFS: ${result.stderr}`);
    }
}

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
