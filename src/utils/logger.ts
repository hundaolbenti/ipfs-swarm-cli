/**
 * Structured logger with colored output levels.
 * Replaces scattered console.log/chalk calls with a consistent API.
 */
import chalk from 'chalk';
import { APP_VERSION } from './constants.js';

export type LogLevel = 'quiet' | 'normal' | 'verbose';
let _logLevel: LogLevel = 'normal';

/** Set log verbosity level (#10) */
export function setLogLevel(level: LogLevel): void {
    _logLevel = level;
}

export function getLogLevel(): LogLevel {
    return _logLevel;
}

export const log = {
    /** Informational message */
    info: (msg: string) => {
        if (_logLevel === 'quiet') return;
        console.log(chalk.cyan('ℹ ') + msg);
    },

    /** Success message */
    success: (msg: string) => console.log(chalk.green('✔ ') + msg),

    /** Warning message */
    warn: (msg: string) => console.log(chalk.yellow('⚠ ') + msg),

    /** Error message */
    error: (msg: string) => console.error(chalk.red('✖ ') + msg),

    /** Debug message (only in verbose mode) */
    debug: (msg: string) => {
        if (_logLevel === 'verbose' || process.env.IPFS_SWARM_DEBUG === '1' || process.env.DEBUG) {
            console.log(chalk.gray('  [debug] ' + msg));
        }
    },

    /** Dimmed/grey text for secondary info */
    dim: (msg: string) => {
        if (_logLevel === 'quiet') return;
        console.log(chalk.gray(msg));
    },

    /** Styled header */
    header: (msg: string) => console.log(chalk.bold.cyan(msg)),

    /** Key-value pair display */
    kv: (key: string, value: string) =>
        console.log(chalk.white(`  ${key}: `) + chalk.yellow(value)),

    /** Blank line */
    br: () => {
        if (_logLevel === 'quiet') return;
        console.log('');
    },

    /** Banner display (#19: uses imported version) */
    banner: () => {
        console.log(chalk.cyan(`
╔══════════════════════════════════════════════════╗
║        IPFS Swarm CLI — Private Network Manager  ║
║        v${APP_VERSION} · Secure · Automated · Modern      ║
╚══════════════════════════════════════════════════╝`));
    },

    /** Section header */
    section: (title: string) => {
        if (_logLevel === 'quiet') return;
        log.br();
        console.log(chalk.bold.white(`── ${title} ──`));
    },

    /** Step indicator for multi-step operations */
    step: (current: number, total: number, msg: string) => {
        console.log(chalk.cyan(`[${current}/${total}]`) + ` ${msg}`);
    },
};
