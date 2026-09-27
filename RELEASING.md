# Releasing

Installed copies of Horadric Loot Box check
`https://github.com/pyrosplat/Horadric-Loot-Box/releases/latest/download/latest.json` for updates.
The GitHub workflow builds and signs everything; you only publish the release.

## One-time setup

1. Create the signing key (keep the private key secret and backed up; if you lose it, installed copies can't update):
   ```bash
   npm run tauri -- signer generate -w ~/.tauri/horadric-loot-box.key
   ```
2. Paste the **public** key (the contents of `horadric-loot-box.key.pub`) into `src-tauri/tauri.conf.json`,
   replacing `REPLACE_WITH_YOUR_UPDATER_PUBLIC_KEY`, and commit it.
3. In the GitHub repo, go to **Settings → Secrets and variables → Actions** and add:
   - `TAURI_SIGNING_PRIVATE_KEY`: the contents of `horadric-loot-box.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password you chose (leave empty if none)

Do this **before** the first public release: only copies built with your public key can update.

## Each release

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, and add notes to `CHANGELOG.md`.
2. Commit, then tag and push:
   ```bash
   git tag v1.0.1
   git push origin main v1.0.1
   ```
3. When the workflow finishes, open the draft release on GitHub, paste the changelog notes, and click **Publish**.
   Installed copies see the update the next time they start (or via Settings → Updates → Check now).

The release notes you publish are what users see in the update dialog.
