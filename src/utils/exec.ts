/**
 * Safe command execution utilities.
 * 
 * SECURITY: Never uses shell interpolation. All commands are executed
 * via execFileSync/spawn with explicit argument arrays, preventing
 * shell injection attacks.
 */
import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { log } from './logger.js';

export interface ExecResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}

/**
 * Execute a command synchronously without shell interpolation.
 * Returns a result object instead of throwing on failure.
 */
export function execSafe(cmd: string, args: string[] = [], options?: { timeout?: number }): ExecResult {
    try {
        const stdout = execFileSync(cmd, args, {
            encoding: 'utf8',
            stdio: 'pipe',
            timeout: options?.timeout ?? 30_000,
        });
        return { success: true, stdout, stderr: '', exitCode: 0 };
    } catch (error: any) {
        return {
            success: false,
            stdout: error.stdout?.toString() ?? '',
            stderr: error.stderr?.toString() ?? error.message ?? '',
            exitCode: error.status ?? 1,
        };
    }
}

/**
 * Execute a command with live output streaming.
 * Returns a promise that resolves with the combined output.
 */
export function execLive(
    cmd: string,
    args: string[] = [],
    options?: SpawnOptions & { silent?: boolean }
): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';

        const { silent, ...spawnOpts } = options ?? {};

        if (!silent) {
            log.dim(`$ ${cmd} ${args.join(' ')}`);
        }

        const child = spawn(cmd, args, {
            stdio: ['inherit', 'pipe', 'pipe'],
            ...spawnOpts,
        });

        child.stdout?.on('data', (data: Buffer) => {
            const text = data.toString();
            stdout += text;
            if (!silent) {
                process.stdout.write(text);
            }
        });

        child.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            stderr += text;
            if (!silent) {
                process.stderr.write(text);
            }
        });

        child.on('error', (err) => {
            reject(new Error(`Failed to execute ${cmd}: ${err.message}`));
        });

        child.on('close', (code) => {
            const exitCode = code ?? 1;
            if (exitCode === 0) {
                resolve({ success: true, stdout, stderr, exitCode });
            } else {
                resolve({ success: false, stdout, stderr, exitCode });
            }
        });
    });
}

/**
 * Spawn a detached background process.
 * Returns the child process handle.
 */
export function execDetached(
    cmd: string,
    args: string[] = [],
    options?: { env?: NodeJS.ProcessEnv }
): ChildProcess {
    const child = spawn(cmd, args, {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options?.env ?? process.env,
    });
    child.unref();
    return child;
}

/**
 * Check if a command exists on the system PATH.
 */
export function commandExists(cmd: string): boolean {
    const result = execSafe(process.platform === 'win32' ? 'where' : 'which', [cmd]);
    return result.success;
}

/**
 * Find the absolute path of a command.
 */
export function findCommand(cmd: string): string | null {
    const result = execSafe(process.platform === 'win32' ? 'where' : 'which', [cmd]);
    return result.success ? result.stdout.trim().split('\n')[0] : null;
}

/**
 * Cached ipfs binary path.
 * Avoids running `which ipfs` on every single CLI call.
 */
let _ipfsPathCache: string | null | undefined;

export function getIpfsPath(): string | null {
    if (_ipfsPathCache === undefined) {
        _ipfsPathCache = findCommand('ipfs');
    }
    return _ipfsPathCache;
}

/** Clear the ipfs path cache (e.g. after installation). */
export function clearIpfsCache(): void {
    _ipfsPathCache = undefined;
}
