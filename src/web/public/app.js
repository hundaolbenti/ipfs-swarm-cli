/**
 * IPFS Swarm Command Center — Client Application
 *
 * Handles: setup wizard, sidebar docs, daemon control, key management,
 * sharing commands, status monitoring, and swarm explorer launch.
 */

const API = window.location.origin;
let ws = null;

/* ═══════════════════════════════════
 *  Theme
 * ═══════════════════════════════════ */
function getTheme() { return localStorage.getItem('ipfs-swarm-theme') || 'dark'; }
function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('ipfs-swarm-theme', t);
    const ic = document.querySelector('#theme-toggle .icon');
    if (ic) ic.textContent = t === 'dark' ? 'light_mode' : 'dark_mode';
}
setTheme(getTheme());
document.getElementById('theme-toggle')?.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'));

/* ═══════════════════════════════════
 *  Sidebar Toggle
 * ═══════════════════════════════════ */
const sidebar = document.getElementById('sidebar');
document.getElementById('toggle-sidebar')?.addEventListener('click', () => sidebar?.classList.toggle('collapsed'));
document.getElementById('close-sidebar')?.addEventListener('click', () => sidebar?.classList.add('collapsed'));

/* ═══════════════════════════════════
 *  Tab Navigation
 * ═══════════════════════════════════ */
document.querySelectorAll('#main-nav .nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#main-nav .nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.content-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`panel-${btn.dataset.tab}`)?.classList.add('active');
    });
});

/* ═══════════════════════════════════
 *  Utilities
 * ═══════════════════════════════════ */
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function showToast(message, type = 'info') {
    let c = document.querySelector('.toast-container');
    if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
    const icons = { success: 'check_circle', error: 'error', info: 'info' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span class="icon">${icons[type] || 'info'}</span> ${escapeHtml(message)}`;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.25s'; setTimeout(() => t.remove(), 250); }, 4000);
}

async function api(path, opts = {}) {
    try {
        const res = await fetch(`${API}${path}`, opts);
        if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
        return await res.json();
    } catch (e) { console.error(`API ${path}:`, e); return null; }
}

window.copyText = function (text) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'info')).catch(() => {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        showToast('Copied!', 'info');
    });
};

function makeCodeBlock(text) {
    return `<div class="share-command" onclick="copyText(\`${text.replace(/`/g, '\\`')}\`)">
        ${escapeHtml(text)}
        <button class="copy-btn icon" onclick="event.stopPropagation();copyText(\`${text.replace(/`/g, '\\`')}\`)">content_copy</button>
    </div>`;
}

/* ═══════════════════════════════════
 *  Documentation Sidebar Content
 * ═══════════════════════════════════ */
function populateDocs() {
    const docs = document.getElementById('docs-content');
    if (!docs) return;

    docs.innerHTML = `
        <div class="sidebar-section">
            <h3>Getting Started</h3>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">rocket_launch</span> Initialize a Node</div>
                <div class="doc-desc">Set up a new node in your swarm</div>
                <div class="code-block" onclick="copyText('ipfs-swarm init')">
                    ipfs-swarm init
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm init')">content_copy</button>
                </div>
            </div>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">play_arrow</span> Start Daemon</div>
                <div class="doc-desc">Start the IPFS daemon in the background</div>
                <div class="code-block" onclick="copyText('ipfs-swarm start')">
                    ipfs-swarm start
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm start')">content_copy</button>
                </div>
            </div>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">stop</span> Stop Daemon</div>
                <div class="doc-desc">Gracefully stop the daemon</div>
                <div class="code-block" onclick="copyText('ipfs-swarm stop')">
                    ipfs-swarm stop
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm stop')">content_copy</button>
                </div>
            </div>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">info</span> Show Status</div>
                <div class="doc-desc">View connected peers and node health</div>
                <div class="code-block" onclick="copyText('ipfs-swarm status')">
                    ipfs-swarm status
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm status')">content_copy</button>
                </div>
            </div>
        </div>

        <div class="sidebar-section">
            <h3>File Management</h3>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">upload_file</span> Add a File</div>
                <div class="doc-desc">Upload and pin a file to the swarm</div>
                <div class="code-block" onclick="copyText('ipfs-swarm files add ./myfile.txt')">
                    ipfs-swarm files add ./myfile.txt
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm files add ./myfile.txt')">content_copy</button>
                </div>
            </div>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">download</span> Get a File</div>
                <div class="doc-desc">Download a file by CID</div>
                <div class="code-block" onclick="copyText('ipfs-swarm files get QmHash...')">
                    ipfs-swarm files get QmHash...
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm files get QmHash...')">content_copy</button>
                </div>
            </div>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">list</span> List Pinned Files</div>
                <div class="doc-desc">See all files pinned on this node</div>
                <div class="code-block" onclick="copyText('ipfs-swarm files list')">
                    ipfs-swarm files list
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm files list')">content_copy</button>
                </div>
            </div>
        </div>

        <div class="sidebar-section">
            <h3>Key Management</h3>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">vpn_key</span> Generate Key</div>
                <div class="doc-desc">Create a new swarm key (bootstrap only)</div>
                <div class="code-block" onclick="copyText('ipfs-swarm key generate')">
                    ipfs-swarm key generate
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm key generate')">content_copy</button>
                </div>
            </div>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">podcasts</span> Serve Key</div>
                <div class="doc-desc">Start a one-time server to share the key</div>
                <div class="code-block" onclick="copyText('ipfs-swarm key serve')">
                    ipfs-swarm key serve
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm key serve')">content_copy</button>
                </div>
            </div>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">download</span> Fetch Key</div>
                <div class="doc-desc">Download the swarm key from a remote host</div>
                <div class="code-block" onclick="copyText('ipfs-swarm key fetch --host 192.168.1.x --port 8899 --pin XXXX')">
                    ipfs-swarm key fetch --host IP --port 8899 --pin PIN
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm key fetch --host 192.168.1.x --port 8899 --pin XXXX')">content_copy</button>
                </div>
            </div>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">enhanced_encryption</span> Export Encrypted</div>
                <div class="doc-desc">Export swarm key with AES-256 encryption</div>
                <div class="code-block" onclick="copyText('ipfs-swarm key export --passphrase \"secret\"')">
                    ipfs-swarm key export --passphrase "secret"
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm key export --passphrase \\\"secret\\\"')">content_copy</button>
                </div>
            </div>
        </div>

        <div class="sidebar-section">
            <h3>Network & Diagnostics</h3>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">language</span> Network Info</div>
                <div class="doc-desc">Show all addresses and Tailscale status</div>
                <div class="code-block" onclick="copyText('ipfs-swarm info')">
                    ipfs-swarm info
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm info')">content_copy</button>
                </div>
            </div>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">speed</span> Test Connectivity</div>
                <div class="doc-desc">Test connection to the swarm</div>
                <div class="code-block" onclick="copyText('ipfs-swarm test')">
                    ipfs-swarm test
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm test')">content_copy</button>
                </div>
            </div>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">explore</span> Web Explorer</div>
                <div class="doc-desc">Open the file explorer web dashboard</div>
                <div class="code-block" onclick="copyText('ipfs-swarm web')">
                    ipfs-swarm web
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm web')">content_copy</button>
                </div>
            </div>
            <div class="doc-item">
                <div class="doc-label"><span class="icon">delete_sweep</span> Clean All Data</div>
                <div class="doc-desc">Remove IPFS data and swarm configuration</div>
                <div class="code-block" onclick="copyText('ipfs-swarm clean --force')">
                    ipfs-swarm clean --force
                    <button class="copy-btn icon" onclick="event.stopPropagation();copyText('ipfs-swarm clean --force')">content_copy</button>
                </div>
            </div>
        </div>
    `;
}

/* ═══════════════════════════════════
 *  Setup Wizard
 * ═══════════════════════════════════ */
let wizardStep = 0;
let selectedNodeType = 'bootstrap';

async function checkSetupNeeded() {
    const data = await api('/api/setup/status');
    if (!data) return;
    if (data.setupMode && !data.configured) {
        document.getElementById('setup-wizard').classList.remove('hidden');
        document.getElementById('command-center').style.display = 'none';
    }
}

function updateWizardUI() {
    document.querySelectorAll('.wizard-step-dot').forEach(d => {
        const s = parseInt(d.dataset.step);
        d.classList.toggle('done', s < wizardStep);
        d.classList.toggle('active', s === wizardStep);
    });
    document.querySelectorAll('.wizard-page').forEach(p => {
        p.classList.toggle('hidden', parseInt(p.dataset.step) !== wizardStep);
    });
    const af = document.getElementById('bootstrap-addr-field');
    if (af) af.classList.toggle('hidden', selectedNodeType !== 'regular');
}

window.wizardNext = function () { if (wizardStep < 3) { wizardStep++; updateWizardUI(); if (wizardStep === 3) runSetup(); } };
window.wizardBack = function () { if (wizardStep > 0) { wizardStep--; updateWizardUI(); } };
window.selectNodeType = function (el) {
    document.querySelectorAll('.selection-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    selectedNodeType = el.dataset.value;
    const af = document.getElementById('bootstrap-addr-field');
    if (af) af.classList.toggle('hidden', selectedNodeType !== 'regular');
};

async function runSetup() {
    const stepKeys = ['kubo', 'init', 'key', 'config'];
    const mark = (k, state) => {
        const el = document.querySelector(`[data-key="${k}"]`);
        if (!el) return;
        el.className = `setup-step ${state}`;
        el.querySelector('.icon').textContent = { pending: 'hourglass_empty', running: 'sync', done: 'check_circle', error: 'error' }[state];
    };
    mark('kubo', 'running');

    try {
        const result = await api('/api/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nodeType: selectedNodeType,
                swarmPort: parseInt(document.getElementById('setup-swarm-port').value) || 4001,
                apiPort: parseInt(document.getElementById('setup-api-port').value) || 5001,
                gatewayPort: parseInt(document.getElementById('setup-gw-port').value) || 8080,
                bootstrapAddr: selectedNodeType === 'regular' ? document.getElementById('setup-bootstrap-addr').value || null : null,
            }),
        });
        if (!result || result.error) throw new Error(result?.error || 'Setup failed');
        stepKeys.forEach(k => mark(k, 'done'));
        document.getElementById('setup-result').classList.remove('hidden');
    } catch (e) {
        stepKeys.forEach(k => mark(k, 'error'));
        const err = document.getElementById('setup-error');
        err.textContent = `Setup failed: ${e.message}`;
        err.classList.remove('hidden');
    }
}

window.finishSetup = function () {
    document.getElementById('setup-wizard').classList.add('hidden');
    document.getElementById('command-center').style.display = '';
    init();
};

/* ═══════════════════════════════════
 *  Load Status (Overview)
 * ═══════════════════════════════════ */
async function loadStatus() {
    const data = await api('/api/status');
    if (!data) return;

    // Update header badge
    const badge = document.getElementById('daemon-status');
    badge.className = `status-badge ${data.running ? 'online' : 'offline'}`;
    badge.querySelector('.status-text').textContent = data.running ? 'Online' : 'Offline';

    // Stats
    document.getElementById('peer-count').textContent = data.peerCount ?? 0;
    document.getElementById('info-peer-id').textContent = data.peerId ?? '—';
    document.getElementById('info-node-type').textContent = data.nodeType ?? '—';
    document.getElementById('info-swarm-port').textContent = data.ports?.swarm ?? '—';
    document.getElementById('info-last-started').textContent = data.lastStarted ? new Date(data.lastStarted).toLocaleString() : 'Never';

    if (data.bandwidth) {
        document.getElementById('bandwidth').textContent = `${data.bandwidth.RateIn || '0 B/s'} / ${data.bandwidth.RateOut || '0 B/s'}`;
    }
    if (data.storage) {
        document.getElementById('repo-size').textContent = data.storage.RepoSize || '—';
    }

    // Update daemon panel too
    updateDaemonPanel(data.running, data);
}

/* ═══════════════════════════════════
 *  Daemon Control
 * ═══════════════════════════════════ */
function updateDaemonPanel(running, data) {
    const indicator = document.getElementById('daemon-indicator');
    const label = document.getElementById('daemon-label');
    const detail = document.getElementById('daemon-detail');
    const startBtn = document.getElementById('btn-daemon-start');
    const stopBtn = document.getElementById('btn-daemon-stop');

    indicator.className = `daemon-status-indicator ${running ? 'online' : 'offline'}`;
    label.textContent = running ? 'Daemon Running' : 'Daemon Stopped';
    detail.textContent = running
        ? `${data?.peerCount ?? 0} peers connected · ${data?.nodeType ?? 'unknown'} node`
        : 'Start the daemon to connect to your swarm';

    startBtn.disabled = running;
    stopBtn.disabled = !running;

    // Daemon info list
    const infoList = document.getElementById('daemon-info-list');
    if (data) {
        infoList.innerHTML = `
            ${infoRow('Status', running ? '● Running' : '○ Stopped')}
            ${infoRow('Peer ID', data.peerId || '—')}
            ${infoRow('Node Type', data.nodeType || '—')}
            ${infoRow('Swarm Port', data.ports?.swarm || '—')}
            ${infoRow('API Port', data.ports?.api || '—')}
            ${infoRow('Gateway Port', data.ports?.gateway || '—')}
            ${infoRow('Peers', String(data.peerCount ?? 0))}
            ${infoRow('Last Started', data.lastStarted ? new Date(data.lastStarted).toLocaleString() : 'Never')}
        `;
    }
}

document.getElementById('btn-daemon-start')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-daemon-start');
    btn.disabled = true;
    btn.innerHTML = '<span class="icon icon-sm" style="animation:spin 1s linear infinite">sync</span> Starting...';
    const result = await api('/api/daemon/start', { method: 'POST' });
    if (result?.success) {
        showToast('Daemon started', 'success');
    } else {
        showToast(result?.error || 'Failed to start', 'error');
    }
    btn.innerHTML = '<span class="icon icon-sm">play_arrow</span> Start';
    await loadStatus();
});

document.getElementById('btn-daemon-stop')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-daemon-stop');
    btn.disabled = true;
    btn.innerHTML = '<span class="icon icon-sm" style="animation:spin 1s linear infinite">sync</span> Stopping...';
    const result = await api('/api/daemon/stop', { method: 'POST' });
    if (result?.success) {
        showToast('Daemon stopped', 'success');
    } else {
        showToast(result?.error || 'Failed to stop', 'error');
    }
    btn.innerHTML = '<span class="icon icon-sm">stop</span> Stop';
    await loadStatus();
});

/* ═══════════════════════════════════
 *  Key Management
 * ═══════════════════════════════════ */
async function loadKeyInfo() {
    const data = await api('/api/key/full');
    const area = document.getElementById('key-info-area');
    if (!area) return;

    if (!data || !data.exists) {
        area.innerHTML = '<div class="empty-state"><span class="icon">vpn_key</span> No swarm key found. Generate one with the Regenerate button.</div>';
        return;
    }

    area.innerHTML = `
        <div class="info-list" style="margin-bottom:12px">
            ${infoRow('Key Fingerprint', data.fingerprint || '—')}
            ${infoRow('Key Path', data.keyPath || '—')}
            ${infoRow('Node Type', data.nodeType || '—')}
            ${infoRow('Node ID', data.nodeId || '—')}
        </div>
        <div style="margin-bottom:8px">
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Full Swarm Key</div>
            <div class="key-display" id="key-full-display">${escapeHtml(data.fullKey || '')}
                <button class="copy-btn icon" onclick="copyText(document.getElementById('key-full-display').textContent.trim())">content_copy</button>
            </div>
        </div>
    `;
}

document.getElementById('btn-copy-key')?.addEventListener('click', async () => {
    const data = await api('/api/key/full');
    if (data?.fullKey) {
        copyText(data.fullKey);
        showToast('Swarm key copied!', 'success');
    } else {
        showToast('No key to copy', 'error');
    }
});

document.getElementById('btn-regen-key')?.addEventListener('click', async () => {
    if (!confirm('Regenerate the swarm key? ALL existing peers will need to reimport the new key.')) return;
    const result = await api('/api/key/regenerate', { method: 'POST' });
    if (result?.success) {
        showToast('Key regenerated', 'success');
        loadKeyInfo();
    } else {
        showToast(result?.error || 'Failed', 'error');
    }
});

document.getElementById('btn-serve-key')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-serve-key');
    btn.disabled = true;
    btn.innerHTML = '<span class="icon icon-sm" style="animation:spin 1s linear infinite">sync</span> Starting...';

    const result = await api('/api/key/serve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    btn.innerHTML = '<span class="icon icon-sm">podcasts</span> Serve Key Now';
    btn.disabled = false;

    const display = document.getElementById('serve-key-result');
    if (result?.success) {
        display.classList.remove('hidden');
        display.innerHTML = `
            <div class="share-method">
                <div class="share-method-head"><span class="icon">check_circle</span><h4 style="color:var(--success)">Key Server Active!</h4></div>
                <div class="share-command-label">PIN (share with colleague)</div>
                ${makeCodeBlock(result.pin)}
                <div class="share-command-label" style="margin-top:8px">Fetch Command (colleague runs this)</div>
                ${makeCodeBlock(`ipfs-swarm key fetch --host ${window.location.hostname} --port ${result.port} --pin ${result.pin}`)}
                <p style="font-size:11px;color:var(--text-tertiary);margin-top:8px">Server auto-destroys after one transfer or 5 min timeout.</p>
            </div>
        `;
    } else {
        display.classList.remove('hidden');
        display.innerHTML = `<p style="color:var(--danger);font-size:12px">${escapeHtml(result?.error || 'Failed to start key server')}</p>`;
    }
});

/* ═══════════════════════════════════
 *  Sharing
 * ═══════════════════════════════════ */
async function loadSharing() {
    const data = await api('/api/sharing');
    if (!data) return;

    // Quick setup steps
    const stepsEl = document.getElementById('quick-setup-steps');
    if (data.commands?.quickSetup) {
        const qs = data.commands.quickSetup;
        stepsEl.innerHTML = `
            ${quickStep(1, 'Install CLI', qs.step1)}
            ${quickStep(2, 'Get Swarm Key', qs.step2)}
            ${quickStep(3, 'Initialize Node', qs.step3)}
            ${quickStep(4, 'Start Daemon', qs.step4)}
            ${quickStep(5, 'Check Status', qs.step5)}
        `;
    }

    // Bootstrap addresses
    const addrsEl = document.getElementById('bootstrap-addrs');
    let addrsHtml = '';
    for (const type of ['local', 'tailscale', 'external']) {
        const cmd = data.commands?.[type];
        if (!cmd) continue;
        addrsHtml += `
            <div class="share-method">
                <div class="share-method-head">
                    <span class="icon">${type === 'local' ? 'lan' : type === 'tailscale' ? 'vpn_lock' : 'public'}</span>
                    <h4>${cmd.label}</h4>
                </div>
                <div class="share-command-label">Bootstrap Address</div>
                ${makeCodeBlock(cmd.bootstrapAddr)}
                <div class="share-command-label" style="margin-top:6px">Join Command</div>
                ${makeCodeBlock(cmd.joinCommand)}
            </div>
        `;
    }
    addrsEl.innerHTML = addrsHtml || '<div class="empty-state"><span class="icon">language</span> Start the daemon to see bootstrap addresses</div>';

    // Key transfer methods
    const keyEl = document.getElementById('key-transfer-methods');
    if (data.commands?.keyTransfer) {
        const kt = data.commands.keyTransfer;
        keyEl.innerHTML = `
            <div class="share-method">
                <div class="share-method-head"><span class="icon">podcasts</span><h4>One-Time Key Server</h4></div>
                <div class="share-command-label">Host runs</div>${makeCodeBlock(kt.serveCommand)}
                <div class="share-command-label" style="margin-top:6px">Colleague runs</div>${makeCodeBlock(kt.fetchCommand)}
            </div>
            <div class="share-method">
                <div class="share-method-head"><span class="icon">terminal</span><h4>SCP / SSH Copy</h4></div>
                ${makeCodeBlock(kt.scpCommand)}
            </div>
        `;
    }
}

function quickStep(n, label, cmd) {
    return `<div class="quick-step">
        <div class="step-num">${n}</div>
        <div class="step-content">
            <div class="step-label">${label}</div>
            ${makeCodeBlock(cmd)}
        </div>
    </div>`;
}

/* ═══════════════════════════════════
 *  Status / Peers / Network
 * ═══════════════════════════════════ */
let peersLoading = false;
async function loadPeers() {
    if (peersLoading) return;
    peersLoading = true;
    const data = await api('/api/peers');
    const c = document.getElementById('peers-list');
    if (!data || data.count === 0) {
        c.innerHTML = '<div class="empty-state"><span class="icon">group_off</span> No peers connected</div>';
    } else {
        c.innerHTML = data.peers.map((p, i) => `<div class="peer-item"><span class="peer-number">${i + 1}</span><span class="peer-addr">${escapeHtml(p)}</span></div>`).join('');
    }
    peersLoading = false;
}

async function loadNetwork() {
    const data = await api('/api/network');
    if (!data) return;

    const netEl = document.getElementById('network-info');
    let rows = '';
    if (data.peerId) rows += infoRow('Peer ID', data.peerId);
    if (data.addresses?.local) rows += infoRow('Local', data.addresses.local);
    if (data.addresses?.tailscale) rows += infoRow('Tailscale', data.addresses.tailscale);
    if (data.addresses?.external) rows += infoRow('External', data.addresses.external);
    if (data.externalIP) rows += infoRow('External IP', data.externalIP);
    netEl.innerHTML = rows || '<div class="empty-state"><span class="icon">wifi_off</span> No network info</div>';

    const tsEl = document.getElementById('tailscale-info');
    let tsRows = '';
    tsRows += infoRow('Installed', data.tailscale?.installed ? 'Yes' : 'No');
    tsRows += infoRow('Running', data.tailscale?.running ? 'Yes' : 'No');
    if (data.tailscale?.ip) tsRows += infoRow('IP', data.tailscale.ip);
    if (data.tailscale?.hostname) tsRows += infoRow('Hostname', data.tailscale.hostname);
    if (data.tailscale?.peers?.length) {
        const on = data.tailscale.peers.filter(p => p.online).length;
        tsRows += infoRow('Peers', `${on}/${data.tailscale.peers.length} online`);
    }
    tsEl.innerHTML = tsRows;

    // Key status in overview
    const keyData = await api('/api/key');
    if (keyData) {
        document.getElementById('info-key-status').textContent = keyData.exists ? `Set (${keyData.fingerprint})` : 'Not set';
    }
}

async function loadPins() {
    const data = await api('/api/pins');
    document.getElementById('pin-count').textContent = data?.count ?? 0;
}

function infoRow(label, value) {
    return `<div class="info-row"><span class="info-label">${escapeHtml(label)}</span><span class="info-value" title="${escapeHtml(String(value))}">${escapeHtml(String(value))}</span></div>`;
}

document.getElementById('refresh-peers-btn')?.addEventListener('click', () => loadPeers());

/* ═══════════════════════════════════
 *  Embedded File Explorer
 * ═══════════════════════════════════ */

// ── Utilities ──
function formatSize(bytes) {
    if (!bytes || bytes === 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function timeAgo(dateStr) {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

const FILE_ICONS = {
    image: { icon: 'image', class: 'image' },
    video: { icon: 'movie', class: 'video' },
    audio: { icon: 'audio_file', class: 'audio' },
    pdf: { icon: 'picture_as_pdf', class: 'document' },
    archive: { icon: 'folder_zip', class: 'archive' },
    code: { icon: 'code', class: 'code' },
    text: { icon: 'description', class: 'document' },
    default: { icon: 'insert_drive_file', class: 'default' },
};

function getFileIcon(filename) {
    if (!filename) return FILE_ICONS.default;
    const ext = filename.split('.').pop()?.toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) return FILE_ICONS.image;
    if (['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) return FILE_ICONS.video;
    if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) return FILE_ICONS.audio;
    if (ext === 'pdf') return FILE_ICONS.pdf;
    if (['zip', 'tar', 'gz', '7z', 'rar', 'bz2'].includes(ext)) return FILE_ICONS.archive;
    if (['js', 'ts', 'py', 'go', 'rs', 'c', 'cpp', 'h', 'java', 'rb', 'sh', 'css', 'html', 'json', 'xml', 'md', 'yaml', 'yml'].includes(ext)) return FILE_ICONS.code;
    if (['txt', 'csv', 'log', 'ini', 'cfg', 'conf'].includes(ext)) return FILE_ICONS.text;
    return FILE_ICONS.default;
}

// ── Upload ──
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');

document.getElementById('browse-btn')?.addEventListener('click', (e) => { e.stopPropagation(); fileInput?.click(); });
uploadZone?.addEventListener('click', () => fileInput?.click());
uploadZone?.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone?.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone?.addEventListener('drop', (e) => {
    e.preventDefault(); uploadZone.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
});
fileInput?.addEventListener('change', () => { if (fileInput.files?.length) uploadFiles(fileInput.files); });

async function uploadFiles(files) {
    const progress = document.getElementById('upload-progress');
    const bar = document.getElementById('progress-bar');
    const status = document.getElementById('upload-status');
    progress.classList.remove('hidden');
    uploadZone.style.display = 'none';

    let uploaded = 0;
    for (const file of files) {
        status.textContent = `Uploading ${file.name} (${uploaded + 1}/${files.length})...`;
        bar.style.width = `${(uploaded / files.length) * 100}%`;

        const form = new FormData();
        form.append('file', file);
        try {
            const result = await api('/api/files/upload', { method: 'POST', body: form });
            if (result?.cid) {
                showToast(`${file.name} → ${result.cid.substring(0, 12)}...`, 'success');
            } else {
                showToast(`Failed: ${file.name}`, 'error');
            }
        } catch (e) {
            showToast(`Upload error: ${e.message}`, 'error');
        }
        uploaded++;
    }

    bar.style.width = '100%';
    status.textContent = `${uploaded} file(s) uploaded!`;
    setTimeout(() => { progress.classList.add('hidden'); uploadZone.style.display = ''; fileInput.value = ''; }, 2000);
    loadPinnedFiles();
    loadPins();
}

// ── Pin by CID ──
document.getElementById('pin-cid-form')?.addEventListener('submit', async () => {
    const cidInput = document.getElementById('pin-cid-input');
    const aliasInput = document.getElementById('pin-alias-input');
    const btn = document.getElementById('btn-pin-cid');
    const cid = cidInput.value.trim();
    if (!cid) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="icon icon-sm" style="animation:spin 1s linear infinite">sync</span>';

    const result = await api('/api/pin-cid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid, name: aliasInput.value.trim() || null }),
    });

    btn.innerHTML = '<span class="icon icon-sm">push_pin</span> Pin';
    btn.disabled = false;

    if (result?.success) {
        showToast(`Pinned: ${cid.substring(0, 16)}...`, 'success');
        cidInput.value = '';
        aliasInput.value = '';
        loadPinnedFiles();
        loadPins();
    } else {
        showToast(result?.error || 'Failed to pin', 'error');
    }
});

// ── Pinned Files Table ──
let allPins = [];

async function loadPinnedFiles() {
    const container = document.getElementById('files-table-container');
    if (!container) return;
    const data = await api('/api/pins');
    if (!data || data.count === 0) {
        allPins = [];
        container.innerHTML = '<div class="empty-state"><span class="icon">folder_open</span> No pinned files yet. Upload or pin a CID above.</div>';
        return;
    }
    allPins = data.pins;
    renderPinsTable(allPins);
}

function renderPinsTable(pins) {
    const container = document.getElementById('files-table-container');
    if (pins.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="icon">search_off</span> No matching files</div>';
        return;
    }

    let html = `<table class="file-table">
        <thead><tr>
            <th>File</th>
            <th>CID</th>
            <th>Size</th>
            <th>Added</th>
            <th style="text-align:right">Actions</th>
        </tr></thead>
        <tbody>`;

    for (const pin of pins) {
        const cid = pin.cid || pin;
        const name = pin.name || null;
        const fi = getFileIcon(name);
        const displayName = name || `<span style="color:var(--text-tertiary);font-style:italic">Unnamed</span>`;
        const shortCid = cid.length > 16 ? cid.substring(0, 8) + '…' + cid.slice(-6) : cid;

        html += `<tr data-cid="${escapeHtml(cid)}" data-name="${escapeHtml(name || '')}">
            <td>
                <div class="col-name">
                    <span class="icon file-icon ${fi.class}">${fi.icon}</span>
                    <span class="file-name" title="${escapeHtml(name || cid)}">${displayName}</span>
                </div>
            </td>
            <td><span class="col-cid" title="${escapeHtml(cid)}">${escapeHtml(shortCid)}</span></td>
            <td class="col-size">${pin.sizeHuman || '—'}</td>
            <td class="col-date" title="${pin.addedAt || ''}">${timeAgo(pin.addedAt)}</td>
            <td>
                <div class="col-actions">
                    <button class="btn btn-sm btn-icon" title="Download" onclick="downloadFile('${cid}')"><span class="icon icon-sm">download</span></button>
                    <button class="btn btn-sm btn-icon" title="Copy CID" onclick="copyText('${cid}')"><span class="icon icon-sm">content_copy</span></button>
                    <button class="btn btn-sm btn-icon btn-danger" title="Unpin" onclick="unpinFile('${cid}')"><span class="icon icon-sm">delete</span></button>
                </div>
            </td>
        </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

// Search/filter
document.getElementById('file-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) { renderPinsTable(allPins); return; }
    const filtered = allPins.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.cid && p.cid.toLowerCase().includes(q))
    );
    renderPinsTable(filtered);
});

window.downloadFile = function (cid) {
    // Opens in a new window — backend sets proper Content-Disposition with original filename
    window.open(`${API}/api/files/${cid}/download`, '_blank');
};

window.unpinFile = async function (cid) {
    if (!confirm(`Unpin ${cid.substring(0, 16)}...?`)) return;
    const result = await api(`/api/files/${cid}/pin`, { method: 'DELETE' });
    if (result?.success) {
        showToast('Unpinned', 'success');
        loadPinnedFiles();
        loadPins();
    } else {
        showToast(result?.error || 'Failed to unpin', 'error');
    }
};

document.getElementById('refresh-files-btn')?.addEventListener('click', () => loadPinnedFiles());

// ── MFS Browser ──
let currentMFSPath = '/';

function renderBreadcrumb(mfsPath) {
    const el = document.getElementById('mfs-breadcrumb');
    if (!el) return;
    const parts = mfsPath.split('/').filter(Boolean);
    let html = `<span class="crumb" onclick="navigateMFS('/')">/</span>`;
    let accumulated = '';
    for (const part of parts) {
        accumulated += '/' + part;
        html += `<span class="sep">›</span><span class="crumb" onclick="navigateMFS('${accumulated}')">${escapeHtml(part)}</span>`;
    }
    el.innerHTML = html;
}

async function loadMFS(mfsPath = '/') {
    currentMFSPath = mfsPath;
    renderBreadcrumb(mfsPath);
    const container = document.getElementById('mfs-table-container');
    if (!container) return;

    const data = await api(`/api/mfs?path=${encodeURIComponent(mfsPath)}`);
    if (!data || !data.files || data.files.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="icon">folder_open</span> Empty directory</div>';
        return;
    }

    let html = `<table class="file-table">
        <thead><tr><th>Name</th><th>CID</th><th>Size</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>`;

    if (mfsPath !== '/') {
        const parent = mfsPath.split('/').slice(0, -1).join('/') || '/';
        html += `<tr style="cursor:pointer" onclick="navigateMFS('${parent}')">
            <td><div class="col-name"><span class="icon file-icon folder">arrow_back</span><span>..</span></div></td>
            <td>—</td><td>—</td><td></td>
        </tr>`;
    }

    for (const file of data.files) {
        const isDir = file.type === 'directory' || file.Type === 1;
        const name = file.name || file.Name || '?';
        const size = file.size || file.Size || 0;
        const cid = file.cid || file.hash || '';
        const fullPath = mfsPath === '/' ? `/${name}` : `${mfsPath}/${name}`;
        const shortCid = cid.length > 14 ? cid.substring(0, 8) + '…' + cid.slice(-4) : cid;
        const fi = isDir ? { icon: 'folder', class: 'folder' } : getFileIcon(name);

        if (isDir) {
            html += `<tr style="cursor:pointer" onclick="navigateMFS('${fullPath}')">
                <td><div class="col-name"><span class="icon file-icon ${fi.class}">${fi.icon}</span><span>${escapeHtml(name)}</span></div></td>
                <td><span class="col-cid">${escapeHtml(shortCid)}</span></td>
                <td class="col-size">—</td>
                <td></td>
            </tr>`;
        } else {
            html += `<tr>
                <td><div class="col-name"><span class="icon file-icon ${fi.class}">${fi.icon}</span><span>${escapeHtml(name)}</span></div></td>
                <td><span class="col-cid" title="${escapeHtml(cid)}">${escapeHtml(shortCid)}</span></td>
                <td class="col-size">${formatSize(size)}</td>
                <td>
                    <div class="col-actions">
                        ${cid ? `<button class="btn btn-sm btn-icon" title="Download" onclick="downloadFile('${cid}')"><span class="icon icon-sm">download</span></button>` : ''}
                        ${cid ? `<button class="btn btn-sm btn-icon" title="Copy CID" onclick="copyText('${cid}')"><span class="icon icon-sm">content_copy</span></button>` : ''}
                        ${cid ? `<button class="btn btn-sm btn-icon" title="Pin" onclick="pinFromMFS('${cid}','${escapeHtml(name)}')"><span class="icon icon-sm">push_pin</span></button>` : ''}
                    </div>
                </td>
            </tr>`;
        }
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

window.navigateMFS = function (p) { loadMFS(p); };

window.pinFromMFS = async function (cid, name) {
    const result = await api('/api/pin-cid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid, name }),
    });
    if (result?.success) {
        showToast(`Pinned: ${name || cid.substring(0, 12)}`, 'success');
        loadPinnedFiles();
        loadPins();
    } else {
        showToast(result?.error || 'Failed to pin', 'error');
    }
};

document.getElementById('refresh-mfs-btn')?.addEventListener('click', () => loadMFS(currentMFSPath));

/* ═══════════════════════════════════
 *  WebSocket
 * ═══════════════════════════════════ */
function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'status') {
                const badge = document.getElementById('daemon-status');
                badge.className = `status-badge ${msg.data.running ? 'online' : 'offline'}`;
                badge.querySelector('.status-text').textContent = msg.data.running ? 'Online' : 'Offline';
                document.getElementById('peer-count').textContent = msg.data.peerCount ?? 0;
                if (msg.data.bandwidth) {
                    document.getElementById('bandwidth').textContent = `${msg.data.bandwidth.RateIn || '0 B/s'} / ${msg.data.bandwidth.RateOut || '0 B/s'}`;
                }
            }
        } catch { }
    };
    ws.onclose = () => setTimeout(connectWS, 3000);
    ws.onerror = () => ws.close();
}

/* ═══════════════════════════════════
 *  Init
 * ═══════════════════════════════════ */
async function init() {
    populateDocs();
    await Promise.all([loadStatus(), loadPins(), loadPeers(), loadNetwork(), loadKeyInfo(), loadSharing(), loadPinnedFiles(), loadMFS()]);
    connectWS();
    setInterval(loadStatus, 30000);
}

checkSetupNeeded().then(() => {
    const wizardVisible = !document.getElementById('setup-wizard').classList.contains('hidden');
    if (!wizardVisible) init();
});
