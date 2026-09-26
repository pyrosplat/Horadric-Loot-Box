//! Item artwork, read at runtime from the player's own Diablo II: Resurrected install.
//!
//! Nothing of Blizzard's is shipped with the app. The game's CASC storage is opened read-only through the
//! vendored CascLib, or an already-extracted data folder is read directly.
//! Inventory sprites (`data/hd/global/ui/items/**.sprite`, format "SpA1") are decoded to PNG on demand and
//! served to the web view through the `hlbart:` URI scheme.

use serde::Serialize;
use std::collections::HashMap;
use std::ffi::{c_char, c_void, CStr, CString};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const ITEMS_DIR: &str = "hd/global/ui/items/";

// ---------------------------------------------------------------------------------------------------------
// CascLib shim (native/hlb_casc.cpp)

extern "C" {
    fn hlb_casc_open(utf8_path: *const c_char, err: *mut u32) -> *mut c_void;
    fn hlb_casc_close(storage: *mut c_void);
    fn hlb_casc_read(
        storage: *mut c_void,
        name: *const c_char,
        out: *mut *mut u8,
        len: *mut u64,
    ) -> u32;
    fn hlb_casc_free(p: *mut u8);
    fn hlb_casc_list(
        storage: *mut c_void,
        mask: *const c_char,
        cb: extern "C" fn(*const c_char, *mut c_void),
        ctx: *mut c_void,
    ) -> u32;
}

struct Casc(*mut c_void);
// The handle is only ever used behind the ArtState mutex.
unsafe impl Send for Casc {}

impl Drop for Casc {
    fn drop(&mut self) {
        unsafe { hlb_casc_close(self.0) }
    }
}

impl Casc {
    fn open(dir: &Path) -> Result<Casc, String> {
        // Tried in order: with D2R's product code, with an empty one, then the bare folder.
        let base = dir
            .to_string_lossy()
            .trim_end_matches(['/', '\\'])
            .to_string();
        let mut last = 0u32;
        for p in [format!("{}:osi", base), format!("{}:", base), base.clone()] {
            let s = CString::new(p.as_bytes()).map_err(|e| e.to_string())?;
            let mut err = 0u32;
            let h = unsafe { hlb_casc_open(s.as_ptr(), &mut err) };
            if !h.is_null() {
                return Ok(Casc(h));
            }
            last = err;
        }
        Err(format!(
            "Could not open the game data in {} (CascLib error {})",
            dir.display(),
            last
        ))
    }

    fn read(&self, name: &str) -> Option<Vec<u8>> {
        let s = CString::new(name).ok()?;
        let mut out: *mut u8 = std::ptr::null_mut();
        let mut len = 0u64;
        let rc = unsafe { hlb_casc_read(self.0, s.as_ptr(), &mut out, &mut len) };
        if rc != 0 || out.is_null() {
            return None;
        }
        let v = unsafe { std::slice::from_raw_parts(out, len as usize).to_vec() };
        unsafe { hlb_casc_free(out) };
        Some(v)
    }

    fn list(&self, mask: &str) -> Vec<String> {
        extern "C" fn cb(name: *const c_char, ctx: *mut c_void) {
            let v = unsafe { &mut *(ctx as *mut Vec<String>) };
            if let Ok(s) = unsafe { CStr::from_ptr(name) }.to_str() {
                v.push(s.to_string());
            }
        }
        let mut names: Vec<String> = Vec::new();
        if let Ok(m) = CString::new(mask) {
            unsafe {
                hlb_casc_list(
                    self.0,
                    m.as_ptr(),
                    cb,
                    &mut names as *mut Vec<String> as *mut c_void,
                )
            };
        }
        names
    }
}

// ---------------------------------------------------------------------------------------------------------
// Sources

enum Source {
    Casc(Casc),
    /// A folder whose `hd/` subfolder mirrors the game's `data/hd/` (e.g. a CascView extraction).
    Folder(PathBuf),
}

impl Source {
    /// `rel` is relative to the game's `data/` folder, e.g. `hd/items/items.json`.
    fn read(&self, rel: &str) -> Option<Vec<u8>> {
        match self {
            Source::Casc(c) => c
                .read(&format!("data:data/{}", rel))
                .or_else(|| c.read(&format!("data/{}", rel))),
            Source::Folder(root) => fs::read(root.join(rel)).ok(),
        }
    }

    /// Every item sprite, as `category/folder/name` keys (no extension), mapped to their real file names.
    fn sprites(&self) -> HashMap<String, SpriteFiles> {
        let mut map: HashMap<String, SpriteFiles> = HashMap::new();
        let mut add = |full: &str| {
            let norm = full.replace('\\', "/");
            let lower = norm.to_ascii_lowercase();
            let Some(pos) = lower.find(ITEMS_DIR) else {
                return;
            };
            let rest = &lower[pos + ITEMS_DIR.len()..];
            let (key, low) = if let Some(k) = rest.strip_suffix(".lowend.sprite") {
                (k, true)
            } else if let Some(k) = rest.strip_suffix(".sprite") {
                (k, false)
            } else {
                return;
            };
            let e = map.entry(key.to_string()).or_default();
            let name = norm[norm.to_ascii_lowercase().find(ITEMS_DIR).unwrap()..].to_string();
            if low {
                e.low = Some(name);
            } else {
                e.hd = Some(name);
            }
        };
        match self {
            Source::Casc(c) => {
                for n in c.list("*") {
                    add(&n);
                }
            }
            Source::Folder(root) => {
                let base = root.join(ITEMS_DIR);
                let mut stack = vec![base];
                while let Some(d) = stack.pop() {
                    for e in fs::read_dir(&d).into_iter().flatten().flatten() {
                        let p = e.path();
                        if p.is_dir() {
                            stack.push(p);
                        } else if let Ok(rel) = p.strip_prefix(root) {
                            add(&rel.to_string_lossy());
                        }
                    }
                }
            }
        }
        map
    }
}

#[derive(Default, Clone)]
struct SpriteFiles {
    /// Names relative to `data/`, e.g. `hd/global/ui/items/weapon/axe/hand_axe.sprite`.
    hd: Option<String>,
    low: Option<String>,
}

/// Finds the data root inside a folder the user picked: the game install (CASC) or an extracted tree.
fn classify(path: &Path) -> Option<(bool, PathBuf)> {
    if path.join(".build.info").is_file()
        && (path.join("Data").is_dir() || path.join("data").is_dir())
    {
        return Some((true, path.to_path_buf()));
    }
    for cand in [
        path.join("data"),
        path.join("Data"),
        path.to_path_buf(),
        path.join("data/data"),
        // the user picked the hd folder itself
        path.parent().map(Path::to_path_buf).unwrap_or_default(),
    ] {
        if cand.join("hd/global/ui/items").is_dir() || cand.join("hd/items/items.json").is_file() {
            return Some((false, cand));
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------------------
// Sprite decoding

/// Decodes a D2R "SpA1" sprite (version 31, 8-bit RGBA) into its first frame.
pub fn decode_sprite(data: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    if data.len() < 0x28 || !data[0..4].eq_ignore_ascii_case(b"SpA1") {
        return Err("not a SpA1 sprite".into());
    }
    let u16_at = |o: usize| u16::from_le_bytes([data[o], data[o + 1]]) as u32;
    let u32_at = |o: usize| u32::from_le_bytes([data[o], data[o + 1], data[o + 2], data[o + 3]]);
    let version = u16_at(4);
    let frame_w = u16_at(6);
    let width = u32_at(8);
    let height = u32_at(12);
    if width == 0 || height == 0 || width > 4096 || height > 4096 {
        return Err("bad sprite size".into());
    }
    let decoded;
    let px: &[u8] = match version {
        31 => data
            .get(0x28..0x28 + (width * height * 4) as usize)
            .ok_or("sprite is truncated")?,
        61 => {
            // Block-compressed (DXT5/BC3). Only accepted when the payload is exactly the expected size.
            let blocks = (width.div_ceil(4) * height.div_ceil(4) * 16) as usize;
            let body = &data[0x28..];
            if body.len() < blocks || body.len() > blocks + 64 {
                return Err("unrecognised compressed sprite layout".into());
            }
            decoded = decode_bc3(&body[..blocks], width, height);
            &decoded
        }
        v => return Err(format!("sprite version {} is not supported", v)),
    };
    let fw = if frame_w > 0 && frame_w < width {
        frame_w
    } else {
        width
    };
    if fw == width {
        return Ok((width, height, px.to_vec()));
    }
    let mut out = Vec::with_capacity((fw * height * 4) as usize);
    for y in 0..height as usize {
        let row = y * width as usize * 4;
        out.extend_from_slice(&px[row..row + fw as usize * 4]);
    }
    Ok((fw, height, out))
}

/// Decodes DXT5 (BC3) blocks into RGBA.
fn decode_bc3(src: &[u8], width: u32, height: u32) -> Vec<u8> {
    let (w, h) = (width as usize, height as usize);
    let mut out = vec![0u8; w * h * 4];
    let bw = w.div_ceil(4);
    for (bi, b) in src.chunks_exact(16).enumerate() {
        let (bx, by) = ((bi % bw) * 4, (bi / bw) * 4);
        let a0 = b[0] as u32;
        let a1 = b[1] as u32;
        let mut alpha = [0u8; 8];
        alpha[0] = a0 as u8;
        alpha[1] = a1 as u8;
        for i in 2..8u32 {
            alpha[i as usize] = if a0 > a1 {
                (((8 - i) * a0 + (i - 1) * a1) / 7) as u8
            } else if i < 6 {
                (((6 - i) * a0 + (i - 1) * a1) / 5) as u8
            } else if i == 6 {
                0
            } else {
                255
            };
        }
        let abits = b[2..8]
            .iter()
            .enumerate()
            .fold(0u64, |acc, (i, &v)| acc | (v as u64) << (8 * i));
        let c = |v: u16| -> [u32; 3] {
            let r = ((v >> 11) & 31) as u32;
            let g = ((v >> 5) & 63) as u32;
            let bl = (v & 31) as u32;
            [
                (r << 3) | (r >> 2),
                (g << 2) | (g >> 4),
                (bl << 3) | (bl >> 2),
            ]
        };
        let c0 = c(u16::from_le_bytes([b[8], b[9]]));
        let c1 = c(u16::from_le_bytes([b[10], b[11]]));
        let mix = |x: [u32; 3], y: [u32; 3], wx: u32, wy: u32| {
            [
                (x[0] * wx + y[0] * wy) / 3,
                (x[1] * wx + y[1] * wy) / 3,
                (x[2] * wx + y[2] * wy) / 3,
            ]
        };
        let colors = [c0, c1, mix(c0, c1, 2, 1), mix(c0, c1, 1, 2)];
        let cbits = u32::from_le_bytes([b[12], b[13], b[14], b[15]]);
        for py in 0..4 {
            for px in 0..4 {
                let (x, y) = (bx + px, by + py);
                if x >= w || y >= h {
                    continue;
                }
                let i = py * 4 + px;
                let col = colors[((cbits >> (2 * i)) & 3) as usize];
                let a = alpha[((abits >> (3 * i)) & 7) as usize];
                let o = (y * w + x) * 4;
                out[o] = col[0] as u8;
                out[o + 1] = col[1] as u8;
                out[o + 2] = col[2] as u8;
                out[o + 3] = a;
            }
        }
    }
    out
}

pub fn to_png(w: u32, h: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        let mut wr = enc.write_header().map_err(|e| e.to_string())?;
        wr.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------------------
// State + commands

struct Opened {
    source: Source,
    sprites: HashMap<String, SpriteFiles>,
    png: HashMap<String, Arc<Vec<u8>>>,
}

#[derive(Default)]
pub struct ArtState(Mutex<Option<Opened>>);

#[derive(Serialize)]
pub struct ArtInfo {
    kind: &'static str,
    path: String,
    /// Sprite keys (`weapon/axe/hand_axe`), lower case, without extension.
    sprites: Vec<String>,
    items_json: Option<String>,
    uniques_json: Option<String>,
    sets_json: Option<String>,
}

fn text(src: &Source, rel: &str) -> Option<String> {
    src.read(rel).map(|b| {
        let b = b.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(&b);
        String::from_utf8_lossy(b).into_owned()
    })
}

fn open_source(path: &Path) -> Result<(Source, &'static str), String> {
    let (casc, root) = classify(path).ok_or_else(|| {
        format!(
            "No game art found in {}. Choose the folder you unpacked the game files into (it has a data/hd folder inside).",
            path.display()
        )
    })?;
    Ok(if casc {
        (Source::Casc(Casc::open(&root)?), "casc")
    } else {
        (Source::Folder(root), "folder")
    })
}

#[tauri::command]
pub fn art_open(state: tauri::State<'_, ArtState>, path: String) -> Result<ArtInfo, String> {
    let (source, kind) = open_source(Path::new(&path))?;
    let sprites = source.sprites();
    let info = ArtInfo {
        kind,
        path: path.clone(),
        sprites: sprites.keys().cloned().collect(),
        items_json: text(&source, "hd/items/items.json"),
        uniques_json: text(&source, "hd/items/uniques.json"),
        sets_json: text(&source, "hd/items/sets.json"),
    };
    if info.sprites.is_empty() && info.items_json.is_none() {
        return Err(format!("No item artwork was found in {}", path));
    }
    *state.0.lock().unwrap() = Some(Opened {
        source,
        sprites,
        png: HashMap::new(),
    });
    Ok(info)
}

#[tauri::command]
pub fn art_close(state: tauri::State<'_, ArtState>) {
    *state.0.lock().unwrap() = None;
}

/// Checks sprite keys directly when the storage can't be listed. Returns the keys that exist.
#[tauri::command]
pub fn art_probe(state: tauri::State<'_, ArtState>, keys: Vec<String>) -> Vec<String> {
    let mut guard = state.0.lock().unwrap();
    let Some(o) = guard.as_mut() else {
        return vec![];
    };
    let mut found = Vec::new();
    for k in keys {
        let k = k.to_ascii_lowercase();
        if o.sprites.contains_key(&k) {
            found.push(k);
            continue;
        }
        let hd = format!("{}{}.sprite", ITEMS_DIR, k);
        let low = format!("{}{}.lowend.sprite", ITEMS_DIR, k);
        let has_hd = o.source.read(&hd).is_some();
        let has_low = !has_hd && o.source.read(&low).is_some();
        if has_hd || has_low {
            o.sprites.insert(
                k.clone(),
                SpriteFiles {
                    hd: has_hd.then_some(hd),
                    low: has_low.then_some(low),
                },
            );
            found.push(k);
        }
    }
    found
}

/// PNG bytes for a sprite key, decoded once and kept in memory.
pub fn sprite_png(state: &ArtState, key: &str) -> Option<Arc<Vec<u8>>> {
    let key = key.trim_matches('/').to_ascii_lowercase();
    let mut guard = state.0.lock().unwrap();
    let o = guard.as_mut()?;
    if let Some(p) = o.png.get(&key) {
        return Some(p.clone());
    }
    let files = o.sprites.get(&key).cloned().unwrap_or(SpriteFiles {
        hd: Some(format!("{}{}.sprite", ITEMS_DIR, key)),
        low: Some(format!("{}{}.lowend.sprite", ITEMS_DIR, key)),
    });
    let png = [files.hd, files.low]
        .into_iter()
        .flatten()
        .find_map(|name| {
            o.source
                .read(&name)
                .and_then(|d| decode_sprite(&d).ok())
                .and_then(|(w, h, px)| to_png(w, h, &px).ok())
        })?;
    let png = Arc::new(png);
    o.png.insert(key, png.clone());
    Some(png)
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = s
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Handles `hlbart://localhost/<key>` (`http://hlbart.localhost/<key>` on Windows).
pub fn protocol_response(state: &ArtState, uri_path: &str) -> tauri::http::Response<Vec<u8>> {
    let key = percent_decode(uri_path.trim_start_matches('/'));
    match sprite_png(state, &key) {
        Some(png) => tauri::http::Response::builder()
            .status(200)
            .header("Content-Type", "image/png")
            .header("Cache-Control", "max-age=31536000, immutable")
            .header("Access-Control-Allow-Origin", "*")
            .body(png.as_ref().clone())
            .unwrap(),
        None => tauri::http::Response::builder()
            .status(404)
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .unwrap(),
    }
}

// ---------------------------------------------------------------------------------------------------------
// Finding the game

fn looks_like_install(p: &Path) -> bool {
    p.join(".build.info").is_file() && (p.join("Data").is_dir() || p.join("data").is_dir())
}

/// Printable runs in Battle.net's product.db that look like D2R install paths.
fn paths_from_product_db(db: &[u8]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut cur = Vec::new();
    for &b in db.iter().chain(std::iter::once(&0u8)) {
        if (0x20..0x7f).contains(&b) {
            cur.push(b);
            continue;
        }
        if cur.len() > 6 {
            let s = String::from_utf8_lossy(&cur).to_string();
            if s.to_ascii_lowercase().contains("diablo ii resurrected")
                && (s.contains(":/") || s.contains(":\\"))
            {
                let start = s.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(0);
                out.push(PathBuf::from(&s[start..]));
            }
        }
        cur.clear();
    }
    out
}

pub fn detect_installs(drive_c_roots: &[PathBuf]) -> Vec<String> {
    let mut cands: Vec<PathBuf> = Vec::new();
    const NAME: &str = "Diablo II Resurrected";
    #[cfg(windows)]
    {
        for pf in ["ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"] {
            if let Ok(p) = std::env::var(pf) {
                cands.push(Path::new(&p).join(NAME));
            }
        }
        for d in b'C'..=b'Z' {
            let root = format!("{}:\\", d as char);
            if !Path::new(&root).exists() {
                continue;
            }
            for sub in [
                "",
                "Games",
                "Program Files (x86)",
                "Program Files",
                "Battle.net",
                "Blizzard",
                "Games\\Battle.net",
            ] {
                cands.push(Path::new(&root).join(sub).join(NAME));
            }
        }
        if let Ok(pd) = std::env::var("ProgramData") {
            if let Ok(db) = fs::read(Path::new(&pd).join("Battle.net/Agent/product.db")) {
                cands.extend(paths_from_product_db(&db));
            }
        }
    }
    for c in drive_c_roots {
        for sub in ["Program Files (x86)", "Program Files", "Games"] {
            cands.push(c.join(sub).join(NAME));
        }
        if let Ok(db) = fs::read(c.join("ProgramData/Battle.net/Agent/product.db")) {
            for p in paths_from_product_db(&db) {
                // "C:/Program Files (x86)/Diablo II Resurrected" -> <prefix>/drive_c/Program Files (x86)/...
                let s = p.to_string_lossy().replace('\\', "/");
                if let Some(rest) = s.strip_prefix("C:/").or_else(|| s.strip_prefix("c:/")) {
                    cands.push(c.join(rest));
                }
            }
        }
    }
    let mut out: Vec<String> = Vec::new();
    for p in cands {
        if looks_like_install(&p) {
            let s = p.to_string_lossy().into_owned();
            if !out.iter().any(|o| o.eq_ignore_ascii_case(&s)) {
                out.push(s);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sprite(w: u32, h: u32, frames: u32) -> Vec<u8> {
        let mut d = b"SpA1".to_vec();
        d.extend_from_slice(&31u16.to_le_bytes());
        d.extend_from_slice(&((w / frames) as u16).to_le_bytes());
        d.extend_from_slice(&w.to_le_bytes());
        d.extend_from_slice(&h.to_le_bytes());
        d.extend_from_slice(&[0u8; 0x28 - 16]);
        for i in 0..(w * h) {
            d.extend_from_slice(&[(i % 256) as u8, 1, 2, 255]);
        }
        d
    }

    #[test]
    fn decodes_single_and_multi_frame_sprites() {
        let (w, h, px) = decode_sprite(&sprite(4, 3, 1)).unwrap();
        assert_eq!((w, h, px.len()), (4, 3, 48));
        let (w, h, px) = decode_sprite(&sprite(8, 2, 2)).unwrap();
        assert_eq!((w, h, px.len()), (4, 2, 32));
        assert_eq!(px[16], 8); // second row starts at source pixel 8
        assert!(decode_sprite(b"nope").is_err());
        let png = to_png(w, h, &px).unwrap();
        assert_eq!(&png[1..4], b"PNG");
    }

    #[test]
    fn decodes_bc3_sprites() {
        // one 4x4 block: alpha 255, colour 0 = pure red (0xF800), all indices 0
        let mut d = b"SpA1".to_vec();
        d.extend_from_slice(&61u16.to_le_bytes());
        d.extend_from_slice(&4u16.to_le_bytes());
        d.extend_from_slice(&4u32.to_le_bytes());
        d.extend_from_slice(&4u32.to_le_bytes());
        d.extend_from_slice(&[0u8; 0x28 - 16]);
        d.extend_from_slice(&[255, 255, 0, 0, 0, 0, 0, 0, 0x00, 0xF8, 0, 0, 0, 0, 0, 0]);
        let (w, h, px) = decode_sprite(&d).unwrap();
        assert_eq!((w, h), (4, 4));
        assert_eq!(&px[0..4], &[255, 0, 0, 255]);
        d.extend_from_slice(&[0u8; 200]);
        assert!(decode_sprite(&d).is_err());
    }

    #[test]
    fn reads_an_extracted_folder() {
        let d = std::env::temp_dir().join(format!("hlb-art-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        let items = d.join("data/hd/global/ui/items/weapon/axe");
        fs::create_dir_all(&items).unwrap();
        fs::write(items.join("hand_axe.sprite"), sprite(4, 6, 1)).unwrap();
        fs::write(items.join("hand_axe.lowend.sprite"), sprite(2, 3, 1)).unwrap();
        fs::create_dir_all(d.join("data/hd/items")).unwrap();
        fs::write(
            d.join("data/hd/items/items.json"),
            "\u{feff}[{\"hax\":{\"asset\":\"axe/hand_axe\"}}]",
        )
        .unwrap();

        let (src, kind) = open_source(&d).unwrap();
        assert_eq!(kind, "folder");
        let sprites = src.sprites();
        assert!(
            sprites.contains_key("weapon/axe/hand_axe"),
            "{:?}",
            sprites.keys().collect::<Vec<_>>()
        );
        assert!(text(&src, "hd/items/items.json").unwrap().starts_with('['));

        let state = ArtState::default();
        *state.0.lock().unwrap() = Some(Opened {
            source: src,
            sprites,
            png: HashMap::new(),
        });
        let png = sprite_png(&state, "weapon/axe/hand_axe").unwrap();
        assert_eq!(&png[1..4], b"PNG");
        assert_eq!(
            protocol_response(&state, "/weapon%2Faxe%2Fhand_axe").status(),
            200
        );
        assert_eq!(
            protocol_response(&state, "/weapon%2Faxe%2Fmissing").status(),
            404
        );
    }

    #[test]
    fn finds_paths_in_product_db() {
        let db = b"\x0a\x22C:\\Program Files (x86)\\Diablo II Resurrected\x12\x04enUS\x00D:/Games/Diablo II Resurrected\x01";
        let p = paths_from_product_db(db);
        assert_eq!(p.len(), 2);
        assert!(p[0]
            .to_string_lossy()
            .starts_with("C:\\Program Files (x86)"));
        assert_eq!(p[1].to_string_lossy(), "D:/Games/Diablo II Resurrected");
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(
            percent_decode("weapon%2Faxe%2Fhand_axe"),
            "weapon/axe/hand_axe"
        );
        assert_eq!(percent_decode("a%2"), "a%2");
    }
}

#[cfg(test)]
mod real_sprite {
    /// Decodes a real game sprite when HV_SPRITE points at one (not part of the normal test run).
    #[test]
    fn decode_real_sprite_if_given() {
        let Ok(p) = std::env::var("HV_SPRITE") else {
            return;
        };
        let d = std::fs::read(&p).unwrap();
        let (w, h, px) = super::decode_sprite(&d).unwrap();
        let out = std::env::var("HV_SPRITE_OUT").unwrap();
        std::fs::write(out, super::to_png(w, h, &px).unwrap()).unwrap();
    }
}
