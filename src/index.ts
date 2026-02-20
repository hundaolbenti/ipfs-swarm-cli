#!/usr/bin/env node
/**
 * ipfs-swarm-cli — Private IPFS Swarm Manager
 * 
 * Deploy, secure, and manage private IPFS networks.
 * Supports encrypted key distribution, Tailscale networking,
 * file management, and a web dashboard.
 */

import { createCli } from './cli.js';

const cli = createCli();
cli.parse(process.argv);

if (!process.argv.slice(2).length) {
    cli.help();
}
