//! Settings "Activate". Copies supporter packs out of a zip the user already has.
//! Looks only for `Little Author Buddy DLC.zip` in Downloads, or a zip the user picks.
//! Nothing is downloaded. Pack scripts are not run.
//! A name with `..`, an empty part, or an absolute path rejects the whole zip.
//! Only `manifest.json` plus `hat.svg` or `game.json` can be written, and only after
//! the same checks that load a pack. An existing pack of the same id is replaced.

use crate::games;
use crate::packs;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager, State};

const ZIP_NAME: &str = "Little Author Buddy DLC.zip";
const ZIP_MAX: u64 = 2 * 1024 * 1024;
const UNCOMPRESSED_MAX: u64 = 2 * 1024 * 1024;
const ENTRY_MAX: usize = 80;
const MANIFEST_MAX: u64 = 8 * 1024;
const GAME_MAX: u64 = 8 * 1024;
const SVG_MAX: u64 = 32 * 1024;

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
pub struct ActivateStatus {
    pub message: String,
    pub installed: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum InstallError {
    Read,
    Unsafe,
    Write,
}

#[derive(Deserialize)]
struct Peek {
    id: String,
    name: String,
    #[serde(rename = "minAppVersion")]
    min_app_version: String,
    #[serde(default)]
    order: i32,
}

enum EntryPath {
    Ignore,
    Root,
    Pack(String, String),
}

enum Named {
    Missing,
    Unreadable,
    Found(PathBuf),
}

struct Incoming {
    files: BTreeMap<String, Vec<u8>>,
    tainted: bool,
}

enum Class {
    Hat,
    Game,
    Newer { name: String, order: i32 },
    Skip,
}

struct Ready {
    id: String,
    files: BTreeMap<String, Vec<u8>>,
    hat: bool,
}

/// `Little Author Buddy DLC.zip` beside the other downloads. A symlink is left unread.
fn named_zip(downloads: &Path) -> Named {
    let path = downloads.join(ZIP_NAME);
    match std::fs::symlink_metadata(&path) {
        Ok(meta) if meta.file_type().is_file() && (1..=ZIP_MAX).contains(&meta.len()) => Named::Found(path),
        Ok(_) => Named::Unreadable,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Named::Missing,
        Err(_) => Named::Unreadable,
    }
}

fn version_parsed(min: &str) -> bool {
    let bits: Vec<&str> = min.trim().split('.').collect();
    !bits.is_empty()
        && bits.len() <= 3
        && bits.iter().all(|b| !b.is_empty() && b.len() <= 6 && b.bytes().all(|c| c.is_ascii_digit()))
}

fn entry_path(raw: &str) -> Result<EntryPath, ()> {
    if raw.is_empty() || raw.contains('\0') {
        return Err(());
    }
    let raw = raw.replace('\\', "/");
    if raw.starts_with('/') {
        return Err(());
    }
    let raw = raw.trim_end_matches('/');
    if raw.is_empty() {
        return Ok(EntryPath::Ignore);
    }
    let mut parts = Vec::new();
    for part in raw.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.len() > 64 {
            return Err(());
        }
        if !part.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-' | b' ')) {
            return Err(());
        }
        parts.push(part.to_string());
    }
    match parts.len() {
        0 => Ok(EntryPath::Ignore),
        1 => Ok(EntryPath::Root),
        2 => Ok(EntryPath::Pack(parts[0].clone(), parts[1].clone())),
        _ => Ok(EntryPath::Ignore),
    }
}

fn file_cap(name: &str) -> Option<u64> {
    match name {
        "manifest.json" => Some(MANIFEST_MAX),
        "game.json" => Some(GAME_MAX),
        "hat.svg" => Some(SVG_MAX),
        _ => None,
    }
}

fn account(total: &mut u64, n: u64) -> Result<(), InstallError> {
    *total = total.checked_add(n).ok_or(InstallError::Unsafe)?;
    if *total > UNCOMPRESSED_MAX { Err(InstallError::Unsafe) } else { Ok(()) }
}

fn unix_symlink(mode: Option<u32>) -> bool {
    const S_IFMT: u32 = 0o170000;
    const S_IFLNK: u32 = 0o120000;
    match mode {
        Some(mode) => mode & S_IFMT == S_IFLNK,
        None => false,
    }
}

fn gather(bytes: &[u8]) -> Result<BTreeMap<String, Incoming>, InstallError> {
    if bytes.len() as u64 > ZIP_MAX {
        return Err(InstallError::Unsafe);
    }
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| InstallError::Read)?;
    if archive.len() > ENTRY_MAX {
        return Err(InstallError::Unsafe);
    }
    let mut packs = BTreeMap::<String, Incoming>::new();
    let mut total = 0u64;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|_| InstallError::Read)?;
        if file.encrypted() || unix_symlink(file.unix_mode()) {
            return Err(InstallError::Unsafe);
        }
        let method = file.compression();
        if method != zip::CompressionMethod::Stored && method != zip::CompressionMethod::Deflated {
            return Err(InstallError::Unsafe);
        }
        if file.size() > UNCOMPRESSED_MAX {
            return Err(InstallError::Unsafe);
        }
        let path = entry_path(file.name()).map_err(|_| InstallError::Unsafe)?;
        if file.is_dir() {
            account(&mut total, file.size())?;
            continue;
        }
        match path {
            EntryPath::Ignore | EntryPath::Root => account(&mut total, file.size())?,
            EntryPath::Pack(id, filename) => {
                if !packs::id_ok(&id) {
                    account(&mut total, file.size())?;
                    continue;
                }
                let slot = packs.entry(id).or_insert_with(|| Incoming { files: BTreeMap::new(), tainted: false });
                let Some(cap) = file_cap(&filename) else {
                    slot.tainted = true;
                    account(&mut total, file.size().min(UNCOMPRESSED_MAX))?;
                    continue;
                };
                if slot.files.contains_key(&filename) || file.size() > cap {
                    slot.tainted = true;
                    account(&mut total, file.size().min(cap))?;
                    continue;
                }
                let mut buf = Vec::new();
                file.by_ref().take(cap + 1).read_to_end(&mut buf).map_err(|_| InstallError::Read)?;
                if buf.len() as u64 > cap {
                    slot.tainted = true;
                    account(&mut total, cap)?;
                    continue;
                }
                account(&mut total, buf.len() as u64)?;
                slot.files.insert(filename, buf);
            }
        }
    }
    Ok(packs)
}

fn class_of(id: &str, incoming: &Incoming) -> Result<Class, InstallError> {
    let manifest = incoming.files.get("manifest.json");
    if let Some(raw) = manifest {
        if let Ok(peek) = serde_json::from_slice::<Peek>(raw) {
            if peek.id == id && version_parsed(&peek.min_app_version) && !packs::version_ok(&peek.min_app_version) {
                let name = packs::clean_label(&peek.name).unwrap_or_else(|| id.to_string());
                return Ok(Class::Newer { name, order: peek.order });
            }
        }
    }
    if incoming.tainted || incoming.files.len() != 2 || manifest.is_none() {
        return Ok(Class::Skip);
    }
    let hat = incoming.files.contains_key("hat.svg");
    let game = incoming.files.contains_key("game.json");
    if hat == game {
        return Ok(Class::Skip);
    }
    if !stage_ok(id, &incoming.files)? {
        return Ok(Class::Skip);
    }
    Ok(if hat { Class::Hat } else { Class::Game })
}

struct Stage {
    path: PathBuf,
}

impl Drop for Stage {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn stage_ok(id: &str, files: &BTreeMap<String, Vec<u8>>) -> Result<bool, InstallError> {
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("lwc-activate-{}-{}", std::process::id(), n));
    std::fs::create_dir_all(&path).map_err(|_| InstallError::Write)?;
    let stage = Stage { path };
    let dir = stage.path.join(id);
    std::fs::create_dir(&dir).map_err(|_| InstallError::Write)?;
    for (name, bytes) in files {
        std::fs::write(dir.join(name), bytes).map_err(|_| InstallError::Write)?;
    }
    let hat = packs::list(&stage.path).iter().any(|h| h.id == id);
    let game = games::list(&stage.path).iter().any(|g| g.id == id);
    Ok(hat || game)
}

fn remove_real_dir(root: &Path, dir: &Path) -> Result<(), ()> {
    match std::fs::symlink_metadata(dir) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(()),
        Ok(meta) => {
            if meta.file_type().is_symlink() || !meta.is_dir() {
                return Err(());
            }
            let canon = dir.canonicalize().map_err(|_| ())?;
            if canon.parent() != Some(root) {
                return Err(());
            }
            std::fs::remove_dir_all(dir).map_err(|_| ())
        }
    }
}

fn commit(dest: &Path, id: &str, files: &BTreeMap<String, Vec<u8>>) -> Result<(), ()> {
    if !packs::id_ok(id) {
        return Err(());
    }
    std::fs::create_dir_all(dest).map_err(|_| ())?;
    let meta = std::fs::symlink_metadata(dest).map_err(|_| ())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(());
    }
    let dest = dest.canonicalize().map_err(|_| ())?;
    let target = dest.join(id);
    let staging = dest.join(format!(".incoming-{id}"));
    if target.parent() != Some(dest.as_path()) || staging.parent() != Some(dest.as_path()) {
        return Err(());
    }
    remove_real_dir(&dest, &staging)?;
    std::fs::create_dir(&staging).map_err(|_| ())?;
    let wrote = (|| -> Result<(), ()> {
        for (name, bytes) in files {
            if !matches!(name.as_str(), "manifest.json" | "hat.svg" | "game.json") {
                return Err(());
            }
            let path = staging.join(name);
            if path.parent() != Some(staging.as_path()) {
                return Err(());
            }
            let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|_| ())?;
            f.write_all(bytes).map_err(|_| ())?;
        }
        Ok(())
    })();
    if wrote.is_err() {
        let _ = remove_real_dir(&dest, &staging);
        return Err(());
    }
    if remove_real_dir(&dest, &target).is_err() {
        let _ = remove_real_dir(&dest, &staging);
        return Err(());
    }
    if std::fs::rename(&staging, &target).is_err() {
        let _ = remove_real_dir(&dest, &staging);
        return Err(());
    }
    Ok(())
}

fn join_names(names: &[String]) -> String {
    match names.len() {
        0 => String::new(),
        1 => names[0].clone(),
        2 => format!("{} and {}", names[0], names[1]),
        _ => {
            let (last, rest) = names.split_last().unwrap();
            format!("{}, and {}", rest.join(", "), last)
        }
    }
}

fn count_phrase(n: usize, one: &str, many: &str) -> String {
    if n == 1 { format!("1 {one}") } else { format!("{n} {many}") }
}

fn report(hats: usize, games: usize, newer: &[String], skipped: usize) -> ActivateStatus {
    let mut parts = Vec::new();
    match (hats, games) {
        (0, 0) => {}
        (h, 0) => parts.push(format!("Installed {}.", count_phrase(h, "hat", "hats"))),
        (0, g) => parts.push(format!("Installed {}.", count_phrase(g, "game", "games"))),
        (h, g) => parts.push(format!(
            "Installed {} and {}.",
            count_phrase(h, "hat", "hats"),
            count_phrase(g, "game", "games")
        )),
    }
    if !newer.is_empty() {
        let names = join_names(newer);
        if newer.len() == 1 {
            parts.push(format!("{names} needs a newer Little Author Buddy, so it was left out."));
        } else {
            parts.push(format!("{names} need a newer Little Author Buddy, so they were left out."));
        }
    }
    if skipped > 0 {
        parts.push("Some packs in that zip were left out.".into());
    }
    if parts.is_empty() {
        parts.push("This zip had no supporter packs the app could use.".into());
    }
    ActivateStatus { installed: hats + games > 0, message: parts.join(" ") }
}

/// Installs validated packs into `dest`. Rejects a zip that tries to leave that folder.
fn install_bytes(bytes: &[u8], dest: &Path) -> Result<ActivateStatus, InstallError> {
    let gathered = gather(bytes)?;
    let mut ready = Vec::new();
    let mut newer = Vec::new();
    let mut skipped = 0usize;
    for (id, incoming) in &gathered {
        match class_of(id, incoming)? {
            Class::Hat => ready.push(Ready { id: id.clone(), files: incoming.files.clone(), hat: true }),
            Class::Game => ready.push(Ready { id: id.clone(), files: incoming.files.clone(), hat: false }),
            Class::Newer { name, order } => newer.push((order, name)),
            Class::Skip => skipped += 1,
        }
    }
    newer.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    let newer_names: Vec<String> = newer.into_iter().map(|(_, name)| name).collect();
    let mut hats = 0usize;
    let mut games_n = 0usize;
    let mut failed = 0usize;
    for pack in &ready {
        if commit(dest, &pack.id, &pack.files).is_ok() {
            if pack.hat { hats += 1; } else { games_n += 1; }
        } else {
            failed += 1;
        }
    }
    if !ready.is_empty() && hats + games_n == 0 {
        return Err(InstallError::Write);
    }
    if failed > 0 {
        skipped += failed;
    }
    Ok(report(hats, games_n, &newer_names, skipped))
}

fn read_zip_file(path: &Path) -> Result<Vec<u8>, InstallError> {
    let meta = std::fs::symlink_metadata(path).map_err(|_| InstallError::Read)?;
    if !meta.file_type().is_file() || meta.len() == 0 || meta.len() > ZIP_MAX {
        return Err(InstallError::Read);
    }
    let mut f = std::fs::File::open(path).map_err(|_| InstallError::Read)?;
    let mut buf = Vec::new();
    (&mut f).take(ZIP_MAX + 1).read_to_end(&mut buf).map_err(|_| InstallError::Read)?;
    if buf.len() as u64 > ZIP_MAX { Err(InstallError::Unsafe) } else { Ok(buf) }
}

fn pick_zip(app: &AppHandle) -> Option<PathBuf> {
    let (tx, rx) = std::sync::mpsc::channel();
    if app.run_on_main_thread(move || {
        let picked = rfd::FileDialog::new()
            .set_title("Choose the supporter pack")
            .add_filter("Zip", &["zip"])
            .pick_file();
        let _ = tx.send(picked);
    }).is_err() {
        return None;
    }
    rx.recv().ok().flatten()
}

fn fail(message: &str) -> ActivateStatus {
    ActivateStatus { message: message.into(), installed: false }
}

fn from_path(path: &Path, dest: &Path) -> ActivateStatus {
    match read_zip_file(path).and_then(|bytes| install_bytes(&bytes, dest)) {
        Ok(status) => status,
        Err(InstallError::Unsafe) => fail("That zip could not be used."),
        Err(InstallError::Write) => fail("The packs folder could not be written."),
        Err(InstallError::Read) => fail("That zip could not be read."),
    }
}

/// Copies packs from Downloads, or from a zip the user chooses when that file is absent.
/// The page cannot pass a path. Only this command decides which file is opened.
/// Async so the file dialog is not opened inside the WebView2 click.
#[tauri::command]
pub async fn activate_supporter(app: AppHandle, st: State<'_, crate::state::AppState>) -> Result<ActivateStatus, String> {
    let dest = {
        let s = st.lock().unwrap();
        packs::packs_dir(&s.path)
    };
    let status = match app.path().download_dir().ok().map(|dir| named_zip(&dir)).unwrap_or(Named::Missing) {
        Named::Found(path) => from_path(&path, &dest),
        Named::Unreadable => fail("That zip could not be read."),
        Named::Missing => match pick_zip(&app) {
            Some(path) => from_path(&path, &dest),
            None => fail("Couldn't find Little Author Buddy DLC.zip in Downloads."),
        },
    };
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("lwc-dlc-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn zip_with(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut zw = zip::ZipWriter::new(&mut cursor);
            let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            for (name, bytes) in files {
                zw.start_file(*name, opt).unwrap();
                zw.write_all(bytes).unwrap();
            }
            zw.finish().unwrap();
        }
        cursor.into_inner()
    }

    fn read(path: &Path) -> Vec<u8> {
        std::fs::read(path).unwrap()
    }

    fn supporter(kind: &str, id: &str, file: &str) -> Vec<u8> {
        read(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../supporter").join(kind).join(id).join(file))
    }

    fn zip_supporter() -> Vec<u8> {
        let mut files: Vec<(String, Vec<u8>)> = Vec::new();
        for kind in ["hats", "games"] {
            let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../supporter").join(kind);
            for entry in std::fs::read_dir(base).unwrap() {
                let entry = entry.unwrap();
                if !entry.file_type().unwrap().is_dir() { continue; }
                let id = entry.file_name().into_string().unwrap();
                for file in ["manifest.json", "hat.svg", "game.json"] {
                    let path = entry.path().join(file);
                    if path.is_file() {
                        files.push((format!("{id}/{file}"), std::fs::read(path).unwrap()));
                    }
                }
            }
        }
        files.push(("LICENSE".into(), b"MIT".to_vec()));
        files.push(("README.txt".into(), b"hi".to_vec()));
        let refs: Vec<(&str, &[u8])> = files.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
        zip_with(&refs)
    }

    fn ids(dir: &Path, games_only: bool) -> Vec<String> {
        if games_only {
            games::list(dir).into_iter().map(|g| g.id).collect()
        } else {
            packs::list(dir).into_iter().map(|h| h.id).collect()
        }
    }

    #[test]
    fn the_supporter_zip_installs_hats_and_games() {
        let dest = scratch("all");
        let outside = dest.join("outside.txt");
        let status = install_bytes(&zip_supporter(), &dest).unwrap();
        assert_eq!(status.message, "Installed 5 hats and 5 games.");
        assert!(status.installed);
        let hats_src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../supporter/hats");
        let games_src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../supporter/games");
        assert_eq!(ids(&dest, false), ids(&hats_src, false));
        assert_eq!(ids(&dest, true), ids(&games_src, true));
        assert!(!dest.join("LICENSE").exists());
        assert!(!outside.exists());
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn the_shipped_dlc_zip_installs() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../Little Author Buddy DLC.zip");
        let dest = scratch("shipped");
        let status = install_bytes(&std::fs::read(&path).unwrap(), &dest).unwrap();
        assert_eq!(status.message, "Installed 5 hats and 5 games.");
        assert_eq!(ids(&dest, false).len(), 5);
        assert_eq!(ids(&dest, true).len(), 5);
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn a_path_that_escapes_installs_nothing() {
        let dest = scratch("slip");
        let parent = dest.parent().unwrap().to_path_buf();
        let marker = parent.join(format!("lwc-slip-outside-{}", std::process::id()));
        let _ = std::fs::remove_file(&marker);
        let beanie = supporter("hats", "beanie", "manifest.json");
        let svg = supporter("hats", "beanie", "hat.svg");
        let zip = zip_with(&[
            ("../outside.txt", b"no"),
            ("beanie/manifest.json", &beanie),
            ("beanie/hat.svg", &svg),
        ]);
        let err = install_bytes(&zip, &dest).unwrap_err();
        assert_eq!(err, InstallError::Unsafe);
        assert!(ids(&dest, false).is_empty());
        assert!(!marker.exists());
        let zip = zip_with(&[("beanie/../../outside.txt", b"no")]);
        assert_eq!(install_bytes(&zip, &dest).unwrap_err(), InstallError::Unsafe);
        let zip = zip_with(&[("/etc/passwd", b"no")]);
        assert_eq!(install_bytes(&zip, &dest).unwrap_err(), InstallError::Unsafe);
        let zip = zip_with(&[(r"..\outside.txt", b"no")]);
        assert_eq!(install_bytes(&zip, &dest).unwrap_err(), InstallError::Unsafe);
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn an_extra_file_is_left_out_and_a_backslash_pack_still_installs() {
        let dest = scratch("extra");
        let manifest = supporter("games", "chase", "manifest.json");
        let lines = supporter("games", "chase", "game.json");
        let hat_m = supporter("hats", "beanie", "manifest.json");
        let svg = supporter("hats", "beanie", "hat.svg");
        let zip = zip_with(&[
            ("chase/manifest.json", &manifest),
            ("chase/game.json", &lines),
            ("beanie/manifest.json", &hat_m),
            ("beanie/hat.svg", &svg),
            ("beanie/note.txt", b"no"),
        ]);
        let status = install_bytes(&zip, &dest).unwrap();
        assert_eq!(status.message, "Installed 1 game. Some packs in that zip were left out.");
        assert_eq!(ids(&dest, true), vec!["chase".to_string()]);
        assert!(ids(&dest, false).is_empty());
        assert!(!dest.join("beanie").exists());
        assert!(!dest.join("chase").join("note.txt").exists());

        let zip = zip_with(&[
            (r"chase\manifest.json", &manifest),
            (r"chase\game.json", &lines),
        ]);
        let status = install_bytes(&zip, &dest).unwrap();
        assert!(status.installed);
        assert_eq!(ids(&dest, true), vec!["chase".to_string()]);
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn a_newer_pack_is_named_and_not_written() {
        let dest = scratch("newer");
        let mut manifest = String::from_utf8(supporter("games", "redlight", "manifest.json")).unwrap();
        manifest = manifest.replace("0.7.0", "99.0.0");
        let lines = supporter("games", "redlight", "game.json");
        let hat_m = supporter("hats", "cap", "manifest.json");
        let svg = supporter("hats", "cap", "hat.svg");
        let zip = zip_with(&[
            ("redlight/manifest.json", manifest.as_bytes()),
            ("redlight/game.json", &lines),
            ("cap/manifest.json", &hat_m),
            ("cap/hat.svg", &svg),
        ]);
        let status = install_bytes(&zip, &dest).unwrap();
        assert_eq!(
            status.message,
            "Installed 1 hat. Red Light Green Light needs a newer Little Author Buddy, so it was left out."
        );
        assert!(status.installed);
        assert!(!dest.join("redlight").exists());
        assert_eq!(ids(&dest, false), vec!["cap".to_string()]);
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn replacing_a_pack_drops_the_old_files() {
        let dest = scratch("replace");
        let manifest = supporter("hats", "beanie", "manifest.json");
        let svg = supporter("hats", "beanie", "hat.svg");
        let zip = zip_with(&[("beanie/manifest.json", &manifest), ("beanie/hat.svg", &svg)]);
        assert!(install_bytes(&zip, &dest).unwrap().installed);
        std::fs::write(dest.join("beanie").join("note.txt"), b"old").unwrap();
        let mut marked = svg.clone();
        marked.extend_from_slice(b"<!--newer-hat-->");
        let zip = zip_with(&[("beanie/manifest.json", &manifest), ("beanie/hat.svg", &marked)]);
        assert!(install_bytes(&zip, &dest).unwrap().installed);
        let hat = packs::list(&dest).into_iter().next().unwrap();
        assert!(hat.svg.contains("newer-hat"));
        assert!(!dest.join("beanie").join("note.txt").exists());
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn a_file_where_a_pack_folder_belongs_is_left_alone() {
        let dest = scratch("file");
        std::fs::write(dest.join("beanie"), b"keep").unwrap();
        let manifest = supporter("hats", "beanie", "manifest.json");
        let svg = supporter("hats", "beanie", "hat.svg");
        let zip = zip_with(&[("beanie/manifest.json", &manifest), ("beanie/hat.svg", &svg)]);
        let err = install_bytes(&zip, &dest).unwrap_err();
        assert_eq!(err, InstallError::Write);
        assert_eq!(std::fs::read(dest.join("beanie")).unwrap(), b"keep");
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn an_empty_zip_and_the_downloads_name() {
        let dest = scratch("empty");
        let status = install_bytes(&zip_with(&[]), &dest).unwrap();
        assert_eq!(status.message, "This zip had no supporter packs the app could use.");
        assert!(!status.installed);
        let downloads = scratch("downs");
        assert!(matches!(named_zip(&downloads), Named::Missing));
        std::fs::write(downloads.join(ZIP_NAME), b"x").unwrap();
        assert!(matches!(named_zip(&downloads), Named::Found(_)));
        std::fs::remove_file(downloads.join(ZIP_NAME)).unwrap();
        std::fs::create_dir(downloads.join(ZIP_NAME)).unwrap();
        assert!(matches!(named_zip(&downloads), Named::Unreadable));
        let src = include_str!("activate.rs");
        let start = src.find("pub async fn activate_supporter(").unwrap();
        let sig = &src[start..start + src[start..].find('{').unwrap()];
        assert!(!sig.contains("path"));
        assert!(!sig.contains("url"));
        let _ = std::fs::remove_dir_all(&dest);
        let _ = std::fs::remove_dir_all(&downloads);
    }
}
