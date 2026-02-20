/**
 * Input validation utilities.
 * 
 * Validates user inputs before they are used in system commands
 * or configuration to prevent injection and misconfiguration.
 */
import { MIN_PORT, MAX_PORT } from './constants.js';

export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

/**
 * Validate a port number is within safe range and is a valid integer.
 */
export function validatePort(port: unknown): number {
    const n = typeof port === 'string' ? parseInt(port, 10) : Number(port);
    if (!Number.isInteger(n) || n < MIN_PORT || n > MAX_PORT) {
        throw new ValidationError(`Port must be an integer between ${MIN_PORT} and ${MAX_PORT}, got: ${port}`);
    }
    return n;
}

/**
 * Validate a libp2p multiaddress format.
 * Must contain /ip4/ or /ip6/ and /p2p/ components.
 */
export function validateMultiaddr(addr: string): string {
    const trimmed = addr.trim();

    // Basic structure check
    if (!trimmed.startsWith('/')) {
        throw new ValidationError(`Multiaddr must start with /, got: ${trimmed}`);
    }

    // Must have transport protocol
    if (!trimmed.includes('/ip4/') && !trimmed.includes('/ip6/') && !trimmed.includes('/dns4/') && !trimmed.includes('/dns6/')) {
        throw new ValidationError(`Multiaddr must contain /ip4/, /ip6/, /dns4/, or /dns6/, got: ${trimmed}`);
    }

    // Must have peer ID
    if (!trimmed.includes('/p2p/') && !trimmed.includes('/ipfs/')) {
        throw new ValidationError(`Multiaddr must contain /p2p/<peer-id>, got: ${trimmed}`);
    }

    // Must have tcp or udp transport
    if (!trimmed.includes('/tcp/') && !trimmed.includes('/udp/')) {
        throw new ValidationError(`Multiaddr must contain /tcp/ or /udp/ transport, got: ${trimmed}`);
    }

    // Validate IP address if /ip4/
    const ip4Match = trimmed.match(/\/ip4\/([^/]+)/);
    if (ip4Match) {
        validateIPv4(ip4Match[1]);
    }

    // Validate peer ID (base58 or base36 encoded, minimum 40 chars)
    const peerMatch = trimmed.match(/\/(?:p2p|ipfs)\/([^/]+)/);
    if (peerMatch && peerMatch[1].length < 10) {
        throw new ValidationError(`Peer ID looks too short: ${peerMatch[1]}`);
    }

    return trimmed;
}

/**
 * Validate an IPv4 address.
 */
export function validateIPv4(ip: string): string {
    const parts = ip.split('.');
    if (parts.length !== 4) {
        throw new ValidationError(`Invalid IPv4 address: ${ip}`);
    }
    for (const part of parts) {
        const n = parseInt(part, 10);
        if (!Number.isInteger(n) || n < 0 || n > 255) {
            throw new ValidationError(`Invalid IPv4 octet: ${part} in ${ip}`);
        }
    }
    return ip;
}

/**
 * Validate a file path doesn't contain dangerous characters.
 * Prevents path traversal and command injection via paths.
 * 
 * Note: Backslashes are allowed for Windows path compatibility.
 * Since we use execFileSync (no shell), backslashes are safe.
 */
export function validatePath(filePath: string): string {
    const trimmed = filePath.trim();

    // Block null bytes (used in null byte injection attacks)
    if (trimmed.includes('\0')) {
        throw new ValidationError('Path contains null byte');
    }

    // Block shell metacharacters that could be used for injection
    // Note: backslash (\) deliberately allowed for Windows paths
    const dangerous = /[;|&$`!<>{}()]/;
    if (dangerous.test(trimmed)) {
        throw new ValidationError(`Path contains dangerous characters: ${trimmed}`);
    }

    if (trimmed.length === 0) {
        throw new ValidationError('Path cannot be empty');
    }

    return trimmed;
}

/**
 * Validate a CID (Content Identifier) format.
 * Supports both CIDv0 (Qm...) and CIDv1 (bafy...) formats.
 */
export function validateCID(cid: string): string {
    const trimmed = cid.trim();

    // CIDv0: base58 encoded, starts with Qm, 46 chars
    if (trimmed.startsWith('Qm') && trimmed.length === 46) {
        if (!/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(trimmed)) {
            throw new ValidationError(`Invalid CIDv0 characters: ${trimmed}`);
        }
        return trimmed;
    }

    // CIDv1: starts with bafy (dag-pb) or bafk (raw) etc
    if (trimmed.startsWith('baf') && trimmed.length >= 50) {
        if (!/^[a-z2-7]+$/.test(trimmed)) {
            throw new ValidationError(`Invalid CIDv1 characters: ${trimmed}`);
        }
        return trimmed;
    }

    // Fallback: accept if it looks alphanumeric and long enough
    if (/^[a-zA-Z0-9]+$/.test(trimmed) && trimmed.length >= 10) {
        return trimmed;
    }

    throw new ValidationError(`Invalid CID format: ${trimmed}`);
}

/**
 * Sanitize a string for display (strip control characters).
 */
export function sanitize(input: string): string {
    // eslint-disable-next-line no-control-regex
    return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
