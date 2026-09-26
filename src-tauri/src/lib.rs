//! Native side of Horadric Loot Box: finding save folders, safe file writes, backups and game detection.
//! All save parsing happens in the TypeScript core; this layer only moves bytes.

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

mod art;

const SAVE_DIR_NAME: &str = "Diablo II Resurrected";

#[derive(Serialize)]
struct SaveFileEntry {
    name: String,
    path: String,
    size: u64,
    modified: Option<u64>,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn has_ext(path: &Path, exts: &[&str]) -> bool {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    exts.iter().any(|e| name.ends_with(e))
}

fn is_save(path: &Path) -> bool {
    has_ext(path, &[".d2s", ".d2i"])
}

fn is_vault(path: &Path) -> bool {
    has_ext(path, &[".hlb.json", ".hvault.json"])
}

fn entry_for(path: &Path) -> Option<SaveFileEntry> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    Some(SaveFileEntry {
        name: path.file_name()?.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        size: meta.len(),
        modified,
    })
}

fn children(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|rd| rd.filter_map(|e| e.ok().map(|e| e.path())).collect())
        .unwrap_or_default()
}

fn contains_saves(dir: &Path) -> bool {
    children(dir).iter().any(|p| is_save(p))
}

/// `drive_c` folders of every Proton (incl. extra Steam libraries), Wine, Lutris, Heroic and Bottles prefix.
fn drive_c_roots() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_default();
    let mut out = Vec::new();
    let steam_roots = [
        home.join(".local/share/Steam"),
        home.join(".steam/steam"),
        home.join(".steam/root"),
        home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
    ];
    for root in steam_roots.iter() {
        let mut libraries = vec![root.clone()];
        // extra Steam library folders (SD cards, second drives)
        if let Ok(vdf) = fs::read_to_string(root.join("steamapps/libraryfolders.vdf")) {
            for line in vdf.lines() {
                let line = line.trim();
                if line.starts_with("\"path\"") {
                    if let Some(p) = line.split('"').nth(3) {
                        libraries.push(PathBuf::from(p));
                    }
                }
            }
        }
        for lib in libraries {
            for prefix in children(&lib.join("steamapps/compatdata")) {
                out.push(prefix.join("pfx/drive_c"));
            }
        }
    }
    let mut wine_prefixes = vec![home.join(".wine")];
    wine_prefixes.extend(children(&home.join("Games")));
    wine_prefixes.extend(children(&home.join("Games/Heroic/Prefixes")));
    wine_prefixes.extend(children(
        &home.join(".var/app/com.usebottles.bottles/data/bottles/bottles"),
    ));
    wine_prefixes.extend(children(&home.join(".local/share/bottles/bottles")));
    for prefix in wine_prefixes {
        out.push(prefix.join("drive_c"));
    }
    out.retain(|p| p.is_dir());
    out.dedup();
    out
}

/// Candidate save folders: Windows "Saved Games", plus Proton / Wine / Lutris / Heroic prefixes on Linux and macOS.
#[tauri::command]
fn detect_save_folders() -> Vec<String> {
    let mut found: Vec<PathBuf> = Vec::new();
    let home = dirs::home_dir().unwrap_or_default();

    // Windows (and anything that sets USERPROFILE)
    if let Ok(profile) = std::env::var("USERPROFILE") {
        found.push(Path::new(&profile).join("Saved Games").join(SAVE_DIR_NAME));
    }
    found.push(home.join("Saved Games").join(SAVE_DIR_NAME));
    // macOS
    found.push(
        home.join("Library")
            .join("Application Support")
            .join(SAVE_DIR_NAME),
    );

    // Steam/Proton, Wine, Lutris, Heroic and Bottles prefixes on Linux / SteamOS / macOS
    for drive_c in drive_c_roots() {
        for user in children(&drive_c.join("users")) {
            found.push(user.join("Saved Games").join(SAVE_DIR_NAME));
        }
    }

    let mut out: Vec<String> = Vec::new();
    for p in found {
        if p.is_dir() && contains_saves(&p) {
            let s = p.to_string_lossy().into_owned();
            if !out.contains(&s) {
                out.push(s);
            }
        }
    }
    out
}

#[tauri::command]
fn list_saves(folder: String) -> Result<Vec<SaveFileEntry>, String> {
    let dir = PathBuf::from(folder);
    if !dir.is_dir() {
        return Err(format!("{} is not a folder", dir.display()));
    }
    let mut out: Vec<SaveFileEntry> = children(&dir)
        .iter()
        .filter(|p| is_save(p))
        .filter_map(|p| entry_for(p))
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
fn read_file(path: String) -> Result<Vec<u8>, String> {
    let p = PathBuf::from(&path);
    if !is_save(&p) {
        return Err("Only .d2s and .d2i files can be read".into());
    }
    fs::read(&p).map_err(err)
}

/// Writes to `<file>.hlb-tmp`, flushes to disk, then renames over the original.
fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!(
        "{}.hlb-tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("dat")
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(err)?;
        f.write_all(data).map_err(err)?;
        f.sync_all().map_err(err)?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not replace {}: {}", path.display(), e)
    })
}

#[tauri::command]
fn write_file_atomic(path: String, data: Vec<u8>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !is_save(&p) {
        return Err("Only .d2s and .d2i files can be written".into());
    }
    if !p.exists() {
        return Err(format!(
            "{} no longer exists; refusing to create a new save",
            p.display()
        ));
    }
    atomic_write(&p, &data)
}

fn data_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(err)?.join(sub);
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

#[tauri::command]
fn backup_files(app: AppHandle, paths: Vec<String>) -> Result<String, String> {
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dir = data_dir(&app, "backups")?.join(stamp);
    fs::create_dir_all(&dir).map_err(err)?;
    for path in paths {
        let src = PathBuf::from(&path);
        if !is_save(&src) {
            continue;
        }
        let name = src.file_name().ok_or("bad file name")?;
        fs::copy(&src, dir.join(name))
            .map_err(|e| format!("Backup of {} failed: {}", src.display(), e))?;
        // keep the game's companion files with the character (.key/.ctl/.map/.ma*)
        if let (Some(stem), Some(parent)) = (src.file_stem(), src.parent()) {
            for sib in children(parent) {
                if sib != src && sib.file_stem() == Some(stem) && sib.is_file() {
                    let _ = fs::copy(&sib, dir.join(sib.file_name().unwrap()));
                }
            }
        }
    }
    Ok(dir.to_string_lossy().into_owned())
}

/// Vaults live in a folder next to the character saves, so backing up the save folder backs them up too.
const VAULT_DIR: &str = "HoradricLootBox-Vaults";
const MOVED_NOTE: &str = "MOVED-TO-SAVE-FOLDER.txt";

/// The vault folder inside a save folder. The first time, vaults kept in the app data folder by older
/// versions are copied in (the originals stay, with a note saying where they went).
fn vault_dir(app: &AppHandle, save_folder: &str) -> Result<PathBuf, String> {
    let save = PathBuf::from(save_folder);
    if !save.is_dir() {
        return Err(format!("Save folder {} not found", save.display()));
    }
    let dir = save.join(VAULT_DIR);
    fs::create_dir_all(&dir).map_err(err)?;
    if let Ok(old) = app.path().app_data_dir().map(|d| d.join("vaults")) {
        migrate_vaults(&old, &dir);
    }
    Ok(dir)
}

fn migrate_vaults(old: &Path, new: &Path) {
    if !old.is_dir() || old.join(MOVED_NOTE).exists() {
        return;
    }
    let files: Vec<PathBuf> = children(old).into_iter().filter(|p| is_vault(p)).collect();
    if files.is_empty() {
        return;
    }
    let mut ok = true;
    for f in &files {
        let dst = new.join(f.file_name().unwrap());
        if !dst.exists() && fs::copy(f, &dst).is_err() {
            ok = false;
        }
    }
    if ok {
        let _ = fs::write(
            old.join(MOVED_NOTE),
            format!(
                "Horadric Loot Box 1.0 keeps vaults next to your saves, in:\n{}\n\nThe files here were copied there and are no longer used. You can delete this folder.\n",
                new.display()
            ),
        );
    }
}

#[tauri::command]
fn list_vaults(app: AppHandle, folder: String) -> Result<Vec<SaveFileEntry>, String> {
    let dir = vault_dir(&app, &folder)?;
    Ok(children(&dir)
        .iter()
        .filter(|p| is_vault(p))
        .filter_map(|p| entry_for(p))
        .collect())
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !is_vault(&p) {
        return Err("Only vault files can be read as text".into());
    }
    fs::read_to_string(p).map_err(err)
}

#[tauri::command]
fn write_vault(
    app: AppHandle,
    folder: String,
    name: String,
    text: String,
    existing_path: Option<String>,
) -> Result<String, String> {
    let path = match existing_path {
        Some(p) if is_vault(Path::new(&p)) => PathBuf::from(p),
        _ => {
            let safe: String = name
                .chars()
                .map(|c| {
                    if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                        c
                    } else {
                        '_'
                    }
                })
                .collect();
            let dir = vault_dir(&app, &folder)?;
            let mut p = dir.join(format!("{}.hlb.json", safe.trim()));
            let mut n = 2;
            while p.exists() {
                p = dir.join(format!("{} ({}).hlb.json", safe.trim(), n));
                n += 1;
            }
            p
        }
    };
    if path.exists() {
        // keep one previous copy of every vault
        let _ = fs::copy(&path, path.with_extension("json.bak"));
    }
    atomic_write(&path, text.as_bytes())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn is_game_running() -> bool {
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    sys.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_ascii_lowercase();
        name == "d2r.exe" || name == "d2r"
    })
}

#[tauri::command]
fn reveal_backups(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app, "backups")?;
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd)
        .arg(dir)
        .spawn()
        .map_err(err)?;
    Ok(())
}

/// Game files kept next to a character (.d2s) that belong to it.
const CHARACTER_EXTS: &[&str] = &[
    "d2s", "key", "ctl", "map", "ma0", "ma1", "ma2", "ma3", "ma4", "d2x",
];

/// Deletes a character's .d2s and its companion files. A copy goes to the backups folder first, so a mistake
/// can still be undone by hand. Refused while the game is running.
/// Copies a character's files into `backup_dir`, then deletes them from the save folder. Returns what was deleted.
fn delete_character_files(src: &Path, backup_dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !has_ext(src, &[".d2s"]) {
        return Err("Only character (.d2s) files can be deleted".into());
    }
    if !src.is_file() {
        return Err(format!("{} no longer exists", src.display()));
    }
    let stem = src.file_stem().ok_or("bad file name")?.to_os_string();
    let parent = src.parent().ok_or("bad path")?.to_path_buf();
    let files: Vec<PathBuf> = children(&parent)
        .into_iter()
        .filter(|p| p.is_file() && p.file_stem() == Some(stem.as_os_str()))
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|e| CHARACTER_EXTS.contains(&e.to_ascii_lowercase().as_str()))
                .unwrap_or(false)
        })
        .collect();
    fs::create_dir_all(backup_dir).map_err(err)?;
    for f in &files {
        fs::copy(f, backup_dir.join(f.file_name().unwrap()))
            .map_err(|e| format!("Backup of {} failed: {}", f.display(), e))?;
    }
    for f in &files {
        fs::remove_file(f).map_err(|e| format!("Could not delete {}: {}", f.display(), e))?;
    }
    Ok(files)
}

/// Deletes a character's .d2s and its companion files. A copy goes to the backups folder first, so a mistake
/// can still be undone by hand. Refused while the game is running.
#[tauri::command]
fn delete_character(app: AppHandle, path: String) -> Result<String, String> {
    if is_game_running() {
        return Err(
            "Diablo II: Resurrected is running. Close it before deleting a character.".into(),
        );
    }
    let src = PathBuf::from(&path);
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dir = data_dir(&app, "backups")?.join(format!("{}_deleted_{}", stamp, stem));
    delete_character_files(&src, &dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Deletes a vault file (and its .bak) from the vaults folder, keeping a copy in the backups folder.
#[tauri::command]
fn delete_vault(app: AppHandle, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !is_vault(&p) {
        return Err("Only vault files can be deleted here".into());
    }
    let in_vault_dir = p.parent().and_then(|d| d.file_name()).map(|n| n == VAULT_DIR).unwrap_or(false);
    if !in_vault_dir {
        return Err("That vault isn't in a Horadric Loot Box vaults folder".into());
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dir = data_dir(&app, "backups")?.join(format!("{}_deleted_vault", stamp));
    fs::create_dir_all(&dir).map_err(err)?;
    let name = p.file_name().ok_or("bad file name")?;
    fs::copy(&p, dir.join(name)).map_err(|e| format!("Backup failed: {}", e))?;
    fs::remove_file(&p).map_err(|e| format!("Could not delete {}: {}", p.display(), e))?;
    let _ = fs::remove_file(p.with_extension("json.bak"));
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn art_detect_installs() -> Vec<String> {
    art::detect_installs(&drive_c_roots())
}

/// The app's identifier before it was renamed from Horadric Vault.
const OLD_IDENTIFIER: &str = "com.horadricvault.app";
const IDENTIFIER: &str = "com.horadriclootbox.app";

/// Copies a folder tree, skipping anything that can't be copied (e.g. locked webview files).
fn copy_tree(from: &Path, to: &Path) {
    if fs::create_dir_all(to).is_err() {
        return;
    }
    for entry in fs::read_dir(from).into_iter().flatten().flatten() {
        let (src, dst) = (entry.path(), to.join(entry.file_name()));
        if src.is_dir() {
            copy_tree(&src, &dst);
        } else if !dst.exists() {
            let _ = fs::copy(&src, &dst);
        }
    }
}

/// First run after the rename: copy the old app folders (vaults, backups, and the webview storage that holds
/// the settings) to the new identifier's folders. The old folders are left in place untouched.
fn migrate_from_old_name() {
    for base in [dirs::data_dir(), dirs::data_local_dir()].into_iter().flatten() {
        let (old, new) = (base.join(OLD_IDENTIFIER), base.join(IDENTIFIER));
        if old.is_dir() && !new.exists() {
            copy_tree(&old, &new);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // before the webview starts, so its storage (settings) is carried over too
    migrate_from_old_name();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(art::ArtState::default())
        .register_asynchronous_uri_scheme_protocol("hlbart", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            std::thread::spawn(move || {
                let state = app.state::<art::ArtState>();
                responder.respond(art::protocol_response(&state, &path));
            });
        })
        .invoke_handler(tauri::generate_handler![
            detect_save_folders,
            list_saves,
            read_file,
            write_file_atomic,
            backup_files,
            list_vaults,
            read_text,
            write_vault,
            is_game_running,
            reveal_backups,
            art_detect_installs,
            delete_character,
            delete_vault,
            art::art_open,
            art::art_close,
            art::art_probe
        ])
        .run(tauri::generate_context!())
        .expect("error while running Horadric Loot Box");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("hlb-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn old_vaults_are_copied_into_the_save_folder_once() {
        let d = temp_dir("migrate");
        let (old, new) = (d.join("appdata/vaults"), d.join("saves").join(VAULT_DIR));
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("MainVault.hlb.json"), "{}").unwrap();
        fs::write(old.join("Old.hvault.json"), "{}").unwrap();
        fs::write(old.join("notes.txt"), "x").unwrap();
        migrate_vaults(&old, &new);
        assert!(new.join("MainVault.hlb.json").is_file());
        assert!(new.join("Old.hvault.json").is_file());
        assert!(!new.join("notes.txt").exists());
        assert!(old.join(MOVED_NOTE).is_file());
        assert!(old.join("MainVault.hlb.json").is_file(), "originals are kept");
        // a vault deleted in the new folder is not copied back on the next start
        fs::remove_file(new.join("MainVault.hlb.json")).unwrap();
        migrate_vaults(&old, &new);
        assert!(!new.join("MainVault.hlb.json").exists());
        // an existing vault with the same name is never overwritten
        let d2 = temp_dir("migrate2");
        let (o2, n2) = (d2.join("old"), d2.join(VAULT_DIR));
        fs::create_dir_all(&o2).unwrap();
        fs::create_dir_all(&n2).unwrap();
        fs::write(o2.join("A.hlb.json"), "old").unwrap();
        fs::write(n2.join("A.hlb.json"), "new").unwrap();
        migrate_vaults(&o2, &n2);
        assert_eq!(fs::read_to_string(n2.join("A.hlb.json")).unwrap(), "new");
    }

    #[test]
    fn atomic_write_replaces_file_and_leaves_no_temp() {
        let d = temp_dir("atomic");
        let f = d.join("Hero.d2s");
        fs::write(&f, b"old").unwrap();
        atomic_write(&f, b"new bytes").unwrap();
        assert_eq!(fs::read(&f).unwrap(), b"new bytes");
        assert!(children(&d)
            .iter()
            .all(|p| !p.to_string_lossy().ends_with(".hlb-tmp")));
    }

    #[test]
    fn write_refuses_non_saves_and_missing_files() {
        let d = temp_dir("refuse");
        assert!(write_file_atomic(d.join("x.txt").to_string_lossy().into(), vec![1]).is_err());
        assert!(
            write_file_atomic(d.join("Missing.d2s").to_string_lossy().into(), vec![1]).is_err()
        );
        assert!(read_file(d.join("x.txt").to_string_lossy().into()).is_err());
    }

    #[test]
    fn deletes_only_that_characters_files_after_backing_them_up() {
        let d = temp_dir("delete");
        for f in [
            "Hero.d2s",
            "Hero.key",
            "Hero.ctl",
            "Hero.map",
            "Hero.ma0",
            "Hero.txt",
            "Heroic.d2s",
            "Other.d2s",
            "SharedStashSoftCoreV2.d2i",
        ] {
            fs::write(d.join(f), f.as_bytes()).unwrap();
        }
        let backup = d.join("bk");
        let gone = delete_character_files(&d.join("Hero.d2s"), &backup).unwrap();
        assert_eq!(gone.len(), 5);
        for f in ["Hero.d2s", "Hero.key", "Hero.ctl", "Hero.map", "Hero.ma0"] {
            assert!(!d.join(f).exists(), "{} should be gone", f);
            assert_eq!(fs::read(backup.join(f)).unwrap(), f.as_bytes());
        }
        for f in [
            "Hero.txt",
            "Heroic.d2s",
            "Other.d2s",
            "SharedStashSoftCoreV2.d2i",
        ] {
            assert!(d.join(f).exists(), "{} must stay", f);
        }
        assert!(delete_character_files(&d.join("SharedStashSoftCoreV2.d2i"), &backup).is_err());
        assert!(delete_character_files(&d.join("Missing.d2s"), &backup).is_err());
    }

    #[test]
    fn finds_proton_prefix_saves() {
        let home = temp_dir("home");
        let saves = home.join(".local/share/Steam/steamapps/compatdata/2983472934/pfx/drive_c/users/steamuser/Saved Games/Diablo II Resurrected");
        fs::create_dir_all(&saves).unwrap();
        fs::write(saves.join("Warlock.d2s"), b"x").unwrap();
        std::env::set_var("HOME", &home);
        let found = detect_save_folders();
        assert!(
            found
                .iter()
                .any(|p| p.ends_with("Diablo II Resurrected") && p.contains("compatdata")),
            "{:?}",
            found
        );
        let listed = list_saves(saves.to_string_lossy().into()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Warlock.d2s");
    }
}
