/**
 * CLI command definitions.
 * 
 * All commands are registered here using Commander.js.
 * Each command delegates to the appropriate service module.
 */
import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_VERSION } from './utils/constants.js';
import { log } from './utils/logger.js';
import { setLogLevel } from './utils/logger.js';
import { clearIpfsCache } from './utils/exec.js';
import { validatePort, validateMultiaddr, validatePath } from './utils/validator.js';
import { loadConfig, saveConfig, updateConfig, type SwarmConfig } from './services/config.js';
import { detectKubo, installKubo, initializeIpfs, configureIpfsForPrivateSwarm, checkSystemTools } from './services/kubo.js';
import { generateSwarmKey, installSwarmKey, readSwarmKey, exportKeyEncrypted, importKeyEncrypted, serveKey, fetchKey, copyKeyViaSSH, regenerateSwarmKey } from './services/swarm-key.js';
import { startDaemon, stopDaemon, isDaemonRunning, getPeerId, getSwarmPeers, getNodeIdentity, getBandwidthStats, getRepoStats } from './services/daemon.js';
import { getExternalIP, detectTailscale, buildMultiaddr, isPortAvailable, printNetworkStatus } from './services/network.js';
import { addFile, getFile, pinFile, unpinFile, listPins, getFileInfo, listMFS, formatBytes, catFile } from './services/file-manager.js';
import { startWebServer } from './web/server.js';

export function createCli(): Command {
    const program = new Command();

    program
        .name('ipfs-swarm')
        .description('Private IPFS Swarm Manager — deploy, secure, and manage private IPFS networks')
        .version(APP_VERSION)
        .option('--verbose', 'Enable verbose/debug output')
        .option('--quiet', 'Suppress informational output (errors/warnings still shown)')
        .hook('preAction', (thisCommand) => {
            const opts = thisCommand.opts();
            if (opts.verbose) setLogLevel('verbose');
            else if (opts.quiet) setLogLevel('quiet');
        });

    /* ═══════════════════════════════════════════════════════
     *  INIT — Initialize node
     * ═══════════════════════════════════════════════════════ */
    program
        .command('init')
        .description('Initialize a new IPFS swarm node')
        .option('--bootstrap', 'Set up as bootstrap (primary) node')
        .option('--regular', 'Set up as regular node that joins an existing swarm')
        .option('--swarm-key <path>', 'Path to existing swarm key file')
        .option('--bootstrap-addr <addr>', 'Bootstrap node multiaddress')
        .option('--port <port>', 'Swarm port number', '4001')
        .option('--api-port <port>', 'API port number', '5001')
        .option('--gateway-port <port>', 'Gateway port number', '8080')
        .option('--ipfs-path <path>', 'Custom IPFS repository path')
        .action(async (options) => {
            log.banner();
            const cfg = loadConfig();

            let nodeType = cfg.nodeType;
            let basePort = cfg.basePort;
            let apiPort = cfg.apiPort;
            let gatewayPort = cfg.gatewayPort;
            let swarmKeyPath = options.swarmKey;
            let bootstrapMultiaddr = options.bootstrapAddr;

            // If no CLI flags provided, ask user which setup method they prefer
            if (!options.bootstrap && !options.regular) {
                const { setupMethod } = await inquirer.prompt([{
                    type: 'list',
                    name: 'setupMethod',
                    message: 'How would you like to set up this node?',
                    choices: [
                        { name: '🌐 Web Setup (browser-based wizard — recommended for beginners)', value: 'web' },
                        { name: '⌨️  Terminal Setup (configure in this terminal)', value: 'terminal' },
                    ],
                }]);

                if (setupMethod === 'web') {
                    log.info('Launching web-based setup wizard...');
                    log.info('Open the URL below in your browser to complete setup.');
                    log.br();
                    const port = validatePort(options.port ?? '9876');
                    await startWebServer({
                        port,
                        host: '127.0.0.1',
                        setupMode: true,
                    });
                    return; // Web setup takes over from here
                }
            }

            // Terminal interactive mode
            if (!options.bootstrap && !options.regular) {
                const answers = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'nodeType',
                        message: 'What type of node is this?',
                        choices: [
                            { name: '🌟 Bootstrap Node (First/Primary node — generates swarm key)', value: 'bootstrap' },
                            { name: '🔗 Regular Node (Joins existing swarm)', value: 'regular' },
                        ],
                    },
                    {
                        type: 'number',
                        name: 'basePort',
                        message: 'Swarm port:',
                        default: basePort,
                        validate: (n: number) => {
                            try { validatePort(n); return true; }
                            catch (e: any) { return e.message; }
                        },
                    },
                    {
                        type: 'number',
                        name: 'apiPort',
                        message: 'API port:',
                        default: apiPort,
                        validate: (n: number) => {
                            try { validatePort(n); return true; }
                            catch (e: any) { return e.message; }
                        },
                    },
                    {
                        type: 'number',
                        name: 'gatewayPort',
                        message: 'Gateway port:',
                        default: gatewayPort,
                        validate: (n: number) => {
                            try { validatePort(n); return true; }
                            catch (e: any) { return e.message; }
                        },
                    },
                    {
                        type: 'list',
                        name: 'keyMethod',
                        message: 'How would you like to get the swarm key?',
                        when: (a: any) => a.nodeType === 'regular',
                        choices: [
                            { name: '🌐 Fetch from bootstrap node (key serve)', value: 'fetch' },
                            { name: '📁 Import from file', value: 'file' },
                            { name: '🔒 Import encrypted key file', value: 'encrypted' },
                        ],
                    },
                    {
                        type: 'input',
                        name: 'fetchHost',
                        message: 'Bootstrap node IP/hostname:',
                        when: (a: any) => a.keyMethod === 'fetch',
                    },
                    {
                        type: 'number',
                        name: 'fetchPort',
                        message: 'Key server port:',
                        default: 8899,
                        when: (a: any) => a.keyMethod === 'fetch',
                    },
                    {
                        type: 'input',
                        name: 'fetchPin',
                        message: 'PIN code:',
                        when: (a: any) => a.keyMethod === 'fetch',
                    },
                    {
                        type: 'input',
                        name: 'swarmKeyPath',
                        message: 'Path to swarm key file:',
                        when: (a: any) => a.keyMethod === 'file',
                        validate: (p: string) => {
                            return fs.existsSync(p) || 'File does not exist';
                        },
                    },
                    {
                        type: 'input',
                        name: 'encryptedKeyPath',
                        message: 'Path to encrypted key file:',
                        when: (a: any) => a.keyMethod === 'encrypted',
                    },
                    {
                        type: 'password',
                        name: 'passphrase',
                        message: 'Decryption passphrase:',
                        when: (a: any) => a.keyMethod === 'encrypted',
                    },
                    {
                        type: 'input',
                        name: 'bootstrapMultiaddr',
                        message: 'Bootstrap node multiaddress:',
                        when: (a: any) => a.nodeType === 'regular',
                        validate: (addr: string) => {
                            try { validateMultiaddr(addr); return true; }
                            catch (e: any) { return e.message; }
                        },
                    },
                ]);

                nodeType = answers.nodeType;
                basePort = answers.basePort;
                apiPort = answers.apiPort;
                gatewayPort = answers.gatewayPort;
                bootstrapMultiaddr = answers.bootstrapMultiaddr;

                // Handle key method
                if (answers.keyMethod === 'fetch') {
                    await fetchKey(answers.fetchHost, answers.fetchPort, answers.fetchPin);
                } else if (answers.keyMethod === 'file') {
                    swarmKeyPath = answers.swarmKeyPath;
                } else if (answers.keyMethod === 'encrypted') {
                    importKeyEncrypted(answers.encryptedKeyPath, answers.passphrase);
                }
            } else {
                nodeType = options.bootstrap ? 'bootstrap' : 'regular';
                basePort = validatePort(options.port);
                apiPort = validatePort(options.apiPort);
                gatewayPort = validatePort(options.gatewayPort);
            }

            // ── Step execution ──
            const steps: { name: string; fn: () => Promise<void> | void }[] = [];
            let stepNum = 0;
            const totalSteps = nodeType === 'bootstrap' ? 5 : 6;

            steps.push({
                name: 'Checking system tools',
                fn: () => {
                    const tools = checkSystemTools();
                    if (tools.missing.length > 0) {
                        log.warn(`Missing tools: ${tools.missing.join(', ')} — some features may not work`);
                    }
                },
            });

            steps.push({
                name: 'Installing/detecting Kubo',
                fn: async () => { await installKubo(); },
            });

            steps.push({
                name: 'Initializing IPFS',
                fn: async () => { await initializeIpfs(); },
            });

            if (nodeType === 'bootstrap') {
                steps.push({
                    name: 'Generating swarm key',
                    fn: () => {
                        const keyPath = generateSwarmKey();
                        installSwarmKey(keyPath);
                    },
                });
            } else {
                if (swarmKeyPath) {
                    steps.push({
                        name: 'Installing swarm key',
                        fn: () => { installSwarmKey(swarmKeyPath); },
                    });
                }
            }

            steps.push({
                name: 'Configuring IPFS for private swarm',
                fn: async () => {
                    const kubo = detectKubo();
                    if (!kubo) throw new Error('Kubo not found');
                    await configureIpfsForPrivateSwarm(kubo.path, {
                        swarmPort: basePort,
                        apiPort,
                        gatewayPort,
                        bootstrapMultiaddr,
                    });
                },
            });

            // Execute steps
            for (const step of steps) {
                stepNum++;
                log.step(stepNum, totalSteps, step.name);
                try {
                    await step.fn();
                } catch (e: any) {
                    log.error(`Step failed: ${e.message}`);
                    process.exit(1);
                }
            }

            // Save configuration
            updateConfig({
                nodeType: nodeType as any,
                basePort,
                apiPort,
                gatewayPort,
                bootstrapMultiaddr,
                swarmKey: readSwarmKey() ? '~/.ipfs-swarm/swarm.key' : null,
            });

            log.br();
            log.success('Node initialization complete!');

            if (nodeType === 'bootstrap') {
                log.section('Bootstrap Node Ready');
                log.kv('Swarm Key', '~/.ipfs-swarm/swarm.key');
                log.info('Share the key securely:');
                log.dim('  ipfs-swarm key serve              # One-time PIN-protected server');
                log.dim('  ipfs-swarm key export --encrypt    # AES-256 encrypted file');
                log.dim('  ipfs-swarm key ssh user@host       # SCP transfer');
                log.br();
                log.info('Start the daemon: ipfs-swarm start');
            } else {
                log.section('Regular Node Ready');
                log.kv('Bootstrap', bootstrapMultiaddr ?? 'Not set');
                log.info('Start the daemon: ipfs-swarm start');
            }
        });

    /* ═══════════════════════════════════════════════════════
     *  START — Start daemon
     * ═══════════════════════════════════════════════════════ */
    program
        .command('start')
        .description('Start the IPFS daemon')
        .action(async () => {
            const started = await startDaemon();
            if (!started) {
                process.exit(1);
            }

            // Display node info
            const cfg = loadConfig();
            const peerId = getPeerId();
            if (peerId) {
                await printNetworkStatus(peerId, cfg.basePort);

                if (cfg.nodeType === 'bootstrap') {
                    log.section('Share with regular nodes');
                    const addrs = await buildMultiaddr(peerId, cfg.basePort);
                    const bestAddr = addrs.tailscale ?? addrs.external ?? addrs.local;
                    log.dim(`  ipfs-swarm init --regular --bootstrap-addr "${bestAddr}"`);
                }
            }
        });

    /* ═══════════════════════════════════════════════════════
     *  STOP — Stop daemon
     * ═══════════════════════════════════════════════════════ */
    program
        .command('stop')
        .description('Stop the IPFS daemon')
        .action(async () => {
            const spin = ora('Stopping IPFS daemon...').start();
            await stopDaemon();
            spin.succeed('IPFS daemon stopped');
        });

    /* ═══════════════════════════════════════════════════════
     *  STATUS — Show swarm status
     * ═══════════════════════════════════════════════════════ */
    program
        .command('status')
        .description('Show swarm status and connected peers')
        .action(async () => {
            const cfg = loadConfig();

            if (!isDaemonRunning()) {
                log.error('IPFS daemon is not running. Start it with: ipfs-swarm start');
                return;
            }

            log.success('IPFS daemon is running');
            log.kv('Node Type', cfg.nodeType);
            log.kv('Swarm Port', cfg.basePort.toString());

            // Node identity
            const identity = getNodeIdentity();
            if (identity) {
                log.kv('Peer ID', identity.ID);
            }

            // Connected peers
            const peers = getSwarmPeers();
            log.section(`Connected Peers (${peers.length})`);
            if (peers.length === 0) {
                log.dim('  No peers connected');
            } else {
                peers.forEach((peer, i) => {
                    log.dim(`  ${i + 1}. ${peer}`);
                });
            }

            // Bandwidth
            const bw = getBandwidthStats();
            if (bw) {
                log.section('Bandwidth');
                for (const [key, value] of Object.entries(bw)) {
                    log.kv(key, value as string);
                }
            }

            // Storage
            const repo = getRepoStats();
            if (repo) {
                log.section('Storage');
                for (const [key, value] of Object.entries(repo)) {
                    log.kv(key, value as string);
                }
            }
        });

    /* ═══════════════════════════════════════════════════════
     *  INFO — Show configuration
     * ═══════════════════════════════════════════════════════ */
    program
        .command('info')
        .description('Show node configuration and connection info')
        .action(async () => {
            const cfg = loadConfig();

            log.section('Configuration');
            log.kv('Node Type', cfg.nodeType);
            log.kv('Swarm Port', cfg.basePort.toString());
            log.kv('API Port', cfg.apiPort.toString());
            log.kv('Gateway Port', cfg.gatewayPort.toString());
            log.kv('Network Type', cfg.networkType);
            log.kv('Swarm Key', cfg.swarmKey ? '✔ Set' : '✖ Not set');

            if (cfg.nodeId) {
                log.kv('Peer ID', cfg.nodeId);
                await printNetworkStatus(cfg.nodeId, cfg.basePort);
            }

            if (cfg.nodeType === 'regular' && cfg.bootstrapMultiaddr) {
                log.kv('Bootstrap', cfg.bootstrapMultiaddr);
            }
        });

    /* ═══════════════════════════════════════════════════════
     *  KEY — Swarm key management
     * ═══════════════════════════════════════════════════════ */
    const keyCmd = program
        .command('key')
        .description('Manage swarm key (generate, share, import)');

    keyCmd
        .command('generate')
        .description('Generate a new swarm key')
        .option('--force', 'Regenerate even if key exists')
        .action((options) => {
            if (options.force) {
                regenerateSwarmKey();
            } else {
                generateSwarmKey();
            }
        });

    keyCmd
        .command('serve')
        .description('Start a one-time key server with PIN authentication')
        .option('-p, --port <port>', 'Server port', '8899')
        .option('--tls', 'Enable HTTPS with auto-generated self-signed certificate')
        .action(async (options) => {
            const port = validatePort(options.port);
            const available = await isPortAvailable(port);
            if (!available) {
                log.error(`Port ${port} is already in use`);
                process.exit(1);
            }

            const { pin, url } = await serveKey(port, options.tls ?? false);

            log.section('Key Server Started');
            log.kv('URL', url);
            log.kv('PIN', pin);
            log.br();
            log.info('Share the URL and PIN with the node that needs the key.');
            log.info('The server will auto-close after one successful transfer.');
            log.dim('Press Ctrl+C to cancel.');

            // Keep process alive until server closes
            await new Promise(() => { });
        });

    keyCmd
        .command('fetch')
        .description('Fetch swarm key from a key server')
        .requiredOption('-h, --host <host>', 'Key server host')
        .option('-p, --port <port>', 'Key server port', '8899')
        .requiredOption('--pin <pin>', 'Authentication PIN')
        .action(async (options) => {
            const port = validatePort(options.port);
            await fetchKey(options.host, port, options.pin);
            installSwarmKey();
        });

    keyCmd
        .command('export')
        .description('Export encrypted swarm key')
        .option('-o, --output <path>', 'Output file path')
        .action(async (options) => {
            const { passphrase } = await inquirer.prompt([
                {
                    type: 'password',
                    name: 'passphrase',
                    message: 'Set encryption passphrase:',
                    validate: (p: string) => p.length >= 8 || 'Passphrase must be at least 8 characters',
                },
                {
                    type: 'password',
                    name: 'confirm',
                    message: 'Confirm passphrase:',
                    validate: (c: string, a: any) => c === a.passphrase || 'Passphrases do not match',
                },
            ]);
            exportKeyEncrypted(passphrase, options.output);
        });

    keyCmd
        .command('import')
        .description('Import an encrypted swarm key')
        .requiredOption('-f, --file <path>', 'Path to encrypted key file')
        .action(async (options) => {
            const { passphrase } = await inquirer.prompt([
                {
                    type: 'password',
                    name: 'passphrase',
                    message: 'Decryption passphrase:',
                },
            ]);
            importKeyEncrypted(options.file, passphrase);
            installSwarmKey();
        });

    keyCmd
        .command('ssh')
        .description('Copy swarm key to a remote host via SSH')
        .argument('<target>', 'SSH target (user@host)')
        .action(async (target: string) => {
            await copyKeyViaSSH(target);
        });

    keyCmd
        .command('show')
        .description('Display the current swarm key')
        .action(() => {
            const key = readSwarmKey();
            if (key) {
                log.section('Current Swarm Key');
                console.log(key);
            } else {
                log.warn('No swarm key found');
            }
        });

    /* ═══════════════════════════════════════════════════════
     *  FILES — File management
     * ═══════════════════════════════════════════════════════ */
    const filesCmd = program
        .command('files')
        .description('Manage files on the IPFS swarm');

    filesCmd
        .command('add')
        .description('Add a file or directory to IPFS')
        .argument('<path>', 'File or directory path')
        .action(async (filePath: string) => {
            if (!isDaemonRunning()) {
                log.error('IPFS daemon is not running. Start it with: ipfs-swarm start');
                return;
            }

            const spin = ora('Adding to IPFS...').start();
            try {
                const result = await addFile(filePath);
                spin.succeed(`Added: ${result.cid} (${formatBytes(result.size)})`);
            } catch (e: any) {
                spin.fail(e.message);
            }
        });

    filesCmd
        .command('get')
        .description('Download a file from IPFS by CID')
        .argument('<cid>', 'Content identifier')
        .option('-o, --output <path>', 'Output path')
        .action(async (cid: string, options: any) => {
            if (!isDaemonRunning()) {
                log.error('IPFS daemon is not running');
                return;
            }

            const spin = ora('Downloading from IPFS...').start();
            try {
                const outPath = await getFile(cid, options.output);
                spin.succeed(`Downloaded to: ${outPath}`);
            } catch (e: any) {
                spin.fail(e.message);
            }
        });

    filesCmd
        .command('cat')
        .description('Display file content from IPFS')
        .argument('<cid>', 'Content identifier')
        .action((cid: string) => {
            if (!isDaemonRunning()) {
                log.error('IPFS daemon is not running');
                return;
            }

            try {
                const content = catFile(cid);
                console.log(content);
            } catch (e: any) {
                log.error(e.message);
            }
        });

    filesCmd
        .command('pin')
        .description('Pin a CID to ensure persistence')
        .argument('<cid>', 'Content identifier')
        .action((cid: string) => {
            if (!isDaemonRunning()) {
                log.error('IPFS daemon is not running');
                return;
            }
            pinFile(cid);
        });

    filesCmd
        .command('unpin')
        .description('Unpin a CID')
        .argument('<cid>', 'Content identifier')
        .action((cid: string) => {
            if (!isDaemonRunning()) {
                log.error('IPFS daemon is not running');
                return;
            }
            unpinFile(cid);
        });

    filesCmd
        .command('ls')
        .description('List pinned files or MFS contents')
        .option('--pinned', 'Show only pinned items')
        .option('--mfs [path]', 'Browse MFS directory')
        .action((options: any) => {
            if (!isDaemonRunning()) {
                log.error('IPFS daemon is not running');
                return;
            }

            if (options.mfs !== undefined) {
                const mfsPath = typeof options.mfs === 'string' ? options.mfs : '/';
                const files = listMFS(mfsPath);
                log.section(`MFS: ${mfsPath}`);
                if (files.length === 0) {
                    log.dim('  (empty)');
                } else {
                    for (const f of files) {
                        log.dim(`  ${f.type === 'directory' ? '📁' : '📄'} ${f.name}  ${f.cid}  ${formatBytes(f.size)}`);
                    }
                }
            } else {
                const pins = listPins();
                log.section(`Pinned Items (${pins.length})`);
                if (pins.length === 0) {
                    log.dim('  No pinned items');
                } else {
                    for (const pin of pins) {
                        log.dim(`  📌 ${pin.cid}  (${pin.type})`);
                    }
                }
            }
        });

    filesCmd
        .command('info')
        .description('Show detailed info about a CID')
        .argument('<cid>', 'Content identifier')
        .action((cid: string) => {
            if (!isDaemonRunning()) {
                log.error('IPFS daemon is not running');
                return;
            }

            const info = getFileInfo(cid);
            if (!info) {
                log.error(`CID not found: ${cid}`);
                return;
            }

            log.section('File Info');
            log.kv('CID', info.cid);
            log.kv('Type', info.type);
            log.kv('Size', formatBytes(info.size));
            log.kv('Pinned', info.pinned ? '✔ Yes' : '✖ No');
        });

    /* ═══════════════════════════════════════════════════════
     *  TEST — Connectivity test
     * ═══════════════════════════════════════════════════════ */
    program
        .command('test')
        .description('Test IPFS swarm connectivity')
        .action(async () => {
            if (!isDaemonRunning()) {
                log.error('IPFS daemon is not running');
                return;
            }

            const spin = ora('Testing IPFS...').start();
            try {
                // Add test content
                const testContent = `ipfs-swarm-cli test: ${new Date().toISOString()}`;
                const tmpFile = '/tmp/ipfs-swarm-test.txt';
                fs.writeFileSync(tmpFile, testContent);

                const result = await addFile(tmpFile);
                const retrieved = catFile(result.cid);

                fs.unlinkSync(tmpFile);

                if (retrieved.trim() === testContent) {
                    spin.succeed(`Test passed! CID: ${result.cid}`);
                } else {
                    spin.fail('Content mismatch after retrieval');
                }

                // Check peers
                const peers = getSwarmPeers();
                log.kv('Connected Peers', peers.length.toString());
            } catch (e: any) {
                spin.fail(e.message);
            }
        });

    /* ═══════════════════════════════════════════════════════
     *  SETUP — Web-based setup wizard
     * ═══════════════════════════════════════════════════════ */
    program
        .command('setup')
        .description('Launch the web-based setup wizard (browser-friendly alternative to init)')
        .option('-p, --port <port>', 'Dashboard port', '9876')
        .action(async (options) => {
            log.banner();
            log.section('Setup Wizard');
            log.info('Opening browser-based setup wizard...');
            log.info('If the browser does not open automatically, visit the URL below.');
            log.br();

            const port = validatePort(options.port);
            await startWebServer({
                port,
                host: '127.0.0.1',
                setupMode: true,
            });
        });

    /* ═══════════════════════════════════════════════════════
     *  WEB — Web dashboard
     * ═══════════════════════════════════════════════════════ */
    program
        .command('web')
        .description('Launch the web dashboard')
        .option('-p, --port <port>', 'Dashboard port', '9876')
        .option('--host <host>', 'Bind address (default: 127.0.0.1, use 0.0.0.0 for remote access)', '127.0.0.1')
        .option('--api-token <token>', 'API token for remote access authentication')
        .action(async (options) => {
            const port = validatePort(options.port);
            await startWebServer({
                port,
                host: options.host,
                apiToken: options.apiToken,
            });
        });

    /* ═══════════════════════════════════════════════════════
     *  CLEAN — Cleanup
     * ═══════════════════════════════════════════════════════ */
    program
        .command('clean')
        .description('Remove all IPFS data and swarm configuration')
        .option('--force', 'Skip confirmation prompt')
        .action(async (options) => {
            if (!options.force) {
                const { confirm } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'confirm',
                    message: '⚠️  This will delete ALL IPFS data, pins, and swarm configuration. Continue?',
                    default: false,
                }]);
                if (!confirm) {
                    log.info('Cleanup cancelled');
                    return;
                }
            }

            const spin = ora('Cleaning up...').start();
            try {
                await stopDaemon();

                const ipfsDir = path.join(os.homedir(), '.ipfs');
                const configDir = path.join(os.homedir(), '.ipfs-swarm');

                if (fs.existsSync(ipfsDir)) {
                    fs.rmSync(ipfsDir, { recursive: true, force: true });
                }
                if (fs.existsSync(configDir)) {
                    fs.rmSync(configDir, { recursive: true, force: true });
                }

                spin.succeed('All IPFS data and configuration removed');
            } catch (e: any) {
                spin.fail(e.message);
            }
        });

    return program;
}
