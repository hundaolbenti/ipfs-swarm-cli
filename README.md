# ipfs-swarm-cli

> Private IPFS swarm manager — deploy, secure, and manage private IPFS networks with encrypted key distribution, Tailscale support, file explorer, and web dashboard.

[![npm version](https://img.shields.io/npm/v/ipfs-swarm-cli.svg)](https://www.npmjs.com/package/ipfs-swarm-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Features

- 🔒 **Secure Key Distribution** — 3 methods: PIN-authenticated HTTP server, AES-256-GCM encrypted export, SSH/SCP transfer
- 🌐 **Tailscale Integration** — Auto-detects Tailscale IP, MagicDNS, and peer status
- 📁 **File Explorer** — Add, download, pin, unpin, and browse files on your swarm
- 📊 **Web Dashboard** — Real-time browser UI with WebSocket live updates
- 🔐 **Security First** — No shell injection, validated inputs, restrictive file permissions, lock files
- ⚡ **Cross-Platform** — Linux, macOS, Windows (WSL) with automatic Kubo installation

## Quick Start

```bash
# Install globally
npm install -g ipfs-swarm-cli

# Initialize bootstrap (primary) node
ipfs-swarm init --bootstrap

# Start the daemon
ipfs-swarm start

# Share the swarm key securely
ipfs-swarm key serve
```

### Joining a swarm

```bash
# On a second machine
ipfs-swarm init --regular

# Fetch the key from the bootstrap node
ipfs-swarm key fetch --host <bootstrap-ip> --pin <pin-code>

# Start
ipfs-swarm start
```

## Commands

| Command | Description |
|---------|-------------|
| `ipfs-swarm init` | Initialize node (interactive setup) |
| `ipfs-swarm start` | Start IPFS daemon |
| `ipfs-swarm stop` | Stop IPFS daemon |
| `ipfs-swarm status` | Show peers, bandwidth, storage |
| `ipfs-swarm info` | Show configuration & addresses |
| `ipfs-swarm key generate` | Generate new swarm key |
| `ipfs-swarm key serve` | One-time PIN-protected key server |
| `ipfs-swarm key fetch` | Fetch key from server |
| `ipfs-swarm key export` | Export encrypted key file |
| `ipfs-swarm key import` | Import encrypted key file |
| `ipfs-swarm key ssh <target>` | Copy key via SSH/SCP |
| `ipfs-swarm key show` | Display current swarm key |
| `ipfs-swarm files add <path>` | Add file/directory to IPFS |
| `ipfs-swarm files get <cid>` | Download file by CID |
| `ipfs-swarm files cat <cid>` | Display file content |
| `ipfs-swarm files pin <cid>` | Pin a CID |
| `ipfs-swarm files unpin <cid>` | Unpin a CID |
| `ipfs-swarm files ls` | List pinned files |
| `ipfs-swarm files info <cid>` | File details |
| `ipfs-swarm test` | Run connectivity test |
| `ipfs-swarm web` | Launch web dashboard |
| `ipfs-swarm clean` | Remove all IPFS data |

## Key Distribution Methods

### 1. PIN-Protected Server (recommended for LAN/Tailscale)
```bash
# On bootstrap node
ipfs-swarm key serve --port 8899
# Output: PIN: 482901, URL: http://0.0.0.0:8899

# On joining node
ipfs-swarm key fetch --host 192.168.1.10 --pin 482901
```

### 2. Encrypted File Export
```bash
# Export with passphrase
ipfs-swarm key export -o swarm.key.enc
# Transfer the file manually

# Import on other node
ipfs-swarm key import -f swarm.key.enc
```

### 3. SSH/SCP
```bash
ipfs-swarm key ssh user@remote-host
```

## Web Dashboard

```bash
ipfs-swarm web --port 9876
# Open http://localhost:9876
```

Features:
- Real-time node status with WebSocket updates
- Drag & drop file upload
- Pin management
- Peer monitoring
- Tailscale network visualization

## Configuration

Stored at `~/.ipfs-swarm/config.json`:

```json
{
  "version": 2,
  "nodeType": "bootstrap",
  "networkType": "tailscale",
  "basePort": 4001,
  "apiPort": 5001,
  "gatewayPort": 8080,
  "tailscaleIP": "100.64.0.1"
}
```

## Requirements

- Node.js ≥ 18
- Linux / macOS / Windows (WSL)
- `curl` and `tar` (for Kubo installation)
- Optional: [Tailscale](https://tailscale.com) for seamless P2P networking

## License

MIT
