# Publishing Guide — GitHub & npm

Step-by-step instructions to publish `ipfs-swarm-cli` to GitHub and npm.

---

## Prerequisites

```bash
# Make sure you have git, node, and npm
git --version     # ≥ 2.x
node --version    # ≥ 18.x
npm --version     # ≥ 9.x
```

---

## Part 1 — GitHub

### 1.1 Create the repository on GitHub

1. Go to [github.com/new](https://github.com/new)
2. **Repository name**: `ipfs-swarm-cli`
3. **Description**: `Private IPFS swarm manager — deploy, secure, and manage private IPFS networks`
4. **Visibility**: Public (or Private if you prefer)
5. **DO NOT** add README, .gitignore, or license (we already have them)
6. Click **Create repository**

### 1.2 Initialize and push

```bash
cd ~/ipfs-swarm-cli

# Initialize git repository
git init

# Configure your identity (if not set globally)
git config user.name "hunda"
git config user.email "your-email@example.com"

# Stage all files
git add .

# Verify what's staged (index.js, node_modules, dist should NOT appear)
git status

# Commit
git commit -m "v2.0.0 — TypeScript rewrite with Command Center web dashboard"

# Rename branch to main (if needed)
git branch -M main

# Add remote and push
git remote add origin https://github.com/hunda/ipfs-swarm-cli.git
git push -u origin main
```

> **Note**: If you use SSH instead of HTTPS, the remote URL would be:
> `git@github.com:hunda/ipfs-swarm-cli.git`

### 1.3 Create a release tag (optional but recommended)

```bash
git tag -a v2.0.0 -m "v2.0.0 — Full TypeScript rewrite"
git push origin v2.0.0
```

Then on GitHub, go to **Releases → Draft a new release → Choose tag `v2.0.0`** and add release notes.

---

## Part 2 — npm

### 2.1 Create / log into your npm account

```bash
# If you don't have an npm account, create one at https://www.npmjs.com/signup

# Log in from CLI
npm login
# → Enter username, password, email, and OTP if you have 2FA enabled
```

### 2.2 Check the package name is available

```bash
npm search ipfs-swarm-cli
```

If the name is taken, update the `"name"` field in `package.json` to something unique, e.g. `@hunda/ipfs-swarm-cli` (scoped package).

### 2.3 Dry run (verify what gets published)

```bash
npm pack --dry-run
```

This shows exactly which files would be included. You should see:
```
dist/                    ← compiled TypeScript + web public files
dist/web/public/         ← CSS, HTML, JS
README.md
LICENSE
package.json
```

You should **NOT** see: `src/`, `node_modules/`, `index.js`, `tsconfig.json`, `HOWTO.md`.

### 2.4 Publish

```bash
# First time publishing:
npm publish

# If using a scoped name (@hunda/ipfs-swarm-cli), you need --access public:
npm publish --access public
```

The `prepublishOnly` script in `package.json` will automatically run `npm run build` before publishing.

### 2.5 Verify it works

```bash
# Install globally from npm to test
npm install -g ipfs-swarm-cli

# Test the CLI
ipfs-swarm --version
ipfs-swarm --help
```

---

## Part 3 — Future Updates

### Bump version and publish update

```bash
# Bump version (patch, minor, or major)
npm version patch   # 2.0.0 → 2.0.1
# OR
npm version minor   # 2.0.0 → 2.1.0

# This auto-creates a git commit + tag. Push both:
git push && git push --tags

# Publish updated version to npm
npm publish
```

---

## Quick Reference

| Action | Command |
|--------|---------|
| Build | `npm run build` |
| Test | `npm test` |
| Dry-run pack | `npm pack --dry-run` |
| Publish | `npm publish` |
| Bump version | `npm version patch/minor/major` |
| Push with tags | `git push && git push --tags` |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `npm ERR! 403 Forbidden` | Package name taken. Use scoped: `@hunda/ipfs-swarm-cli` |
| `npm ERR! need auth` | Run `npm login` first |
| `git push` rejected | `git pull --rebase origin main` then push again |
| `dist/` not in package | `prepublishOnly` failed. Run `npm run build` manually |
| Binary not working after install | Check `dist/index.js` starts with `#!/usr/bin/env node` |
