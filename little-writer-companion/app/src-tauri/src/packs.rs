//! Supporter hat packs. Source lives in `supporter/`; the app reads `packs/` beside `state.json`.
//! Only `manifest.json` and `hat.svg` are opened, and only from a directory whose name is the pack id.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const ID_MAX: usize = 32;
const NAME_MAX: usize = 48;
const MANIFEST_MAX: u64 = 8 * 1024;
const SVG_MAX: u64 = 32 * 1024;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HatColorMode { Free, Choice }

#[derive(Serialize, Clone, Debug)]
pub struct HatChoice { pub label: String, pub value: String }

/// One installed hat. `svg` is the raw `hat.svg` text; the UI sanitizes it before inserting.
#[derive(Serialize, Clone, Debug)]
pub struct HatInfo {
    pub id: String,
    pub name: String,
    pub order: i32,
    pub color: HatColorMode,
    pub default_color: String,
    pub colors: Vec<HatChoice>,
    pub extra: Option<String>,
    pub svg: String,
}

struct HatRule {
    id: String,
    mode: HatColorMode,
    default_color: String,
    choices: Vec<String>,
    has_extra: bool,
}

struct Found { info: HatInfo, rule: HatRule }

#[derive(Deserialize)]
struct Manifest {
    id: String,
    kind: String,
    name: String,
    #[serde(rename = "minAppVersion")]
    min_app_version: String,
    color: String,
    #[serde(rename = "defaultColor")]
    default_color: String,
    #[serde(default)]
    colors: Vec<ManifestColor>,
    files: Vec<String>,
    #[serde(default)]
    order: i32,
    #[serde(default)]
    extra: Option<ManifestExtra>,
}

#[derive(Deserialize)]
struct ManifestColor { label: String, value: String }

#[derive(Deserialize)]
struct ManifestExtra { label: String }

pub(crate) fn id_ok(id: &str) -> bool {
    let b = id.as_bytes();
    (1..=ID_MAX).contains(&b.len()) && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

fn hex_ok(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.len() == 7 && t.as_bytes()[0] == b'#' && t[1..].bytes().all(|c| c.is_ascii_hexdigit()) {
        Some(t.to_ascii_lowercase())
    } else {
        None
    }
}

pub(crate) fn clean_label(raw: &str) -> Option<String> {
    let t: String = raw.chars().filter(|c| !c.is_control()).take(NAME_MAX).collect();
    let t = t.trim().to_string();
    if t.is_empty() { None } else { Some(t) }
}

/// `min` is `major.minor.patch` (shorter forms pad with 0). Newer than this build is refused.
pub(crate) fn version_ok(min: &str) -> bool {
    fn parts(s: &str) -> Option<[u64; 3]> {
        let mut p = [0u64; 3];
        let bits: Vec<&str> = s.split('.').collect();
        if bits.is_empty() || bits.len() > 3 { return None; }
        for (i, b) in bits.iter().enumerate() {
            if b.is_empty() || !b.bytes().all(|c| c.is_ascii_digit()) || b.len() > 6 { return None; }
            p[i] = b.parse().ok()?;
        }
        Some(p)
    }
    match (parts(min.trim()), parts(env!("CARGO_PKG_VERSION"))) {
        (Some(min), Some(cur)) => min <= cur,
        _ => false,
    }
}

pub(crate) fn read_regular(path: &Path, max: u64) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.file_type().is_file() || meta.len() > max { return None; }
    let text = std::fs::read_to_string(path).ok()?;
    if text.len() as u64 > max { return None; }
    Some(text)
}

fn accept(dir: &Path, id: &str) -> Option<Found> {
    let raw = read_regular(&dir.join("manifest.json"), MANIFEST_MAX)?;
    let m: Manifest = serde_json::from_str(&raw).ok()?;
    if m.id != id || m.kind != "hat" || !m.files.iter().any(|f| f == "hat.svg") { return None; }
    if !version_ok(&m.min_app_version) { return None; }
    let name = clean_label(&m.name)?;
    let default_color = hex_ok(&m.default_color)?;
    let svg = read_regular(&dir.join("hat.svg"), SVG_MAX)?;
    let (mode, colors, choice_values) = match m.color.as_str() {
        "free" => (HatColorMode::Free, Vec::new(), Vec::new()),
        "choice" => {
            let mut colors = Vec::new();
            let mut values = Vec::new();
            for c in m.colors {
                let label = clean_label(&c.label)?;
                let value = hex_ok(&c.value)?;
                if values.iter().any(|v: &String| v == &value) { continue; }
                values.push(value.clone());
                colors.push(HatChoice { label, value });
            }
            if colors.is_empty() || !values.iter().any(|v| v == &default_color) { return None; }
            (HatColorMode::Choice, colors, values)
        }
        _ => return None,
    };
    let extra = m.extra.and_then(|e| clean_label(&e.label));
    let has_extra = extra.is_some();
    Some(Found {
        rule: HatRule { id: id.into(), mode, default_color: default_color.clone(), choices: choice_values, has_extra },
        info: HatInfo { id: id.into(), name, order: m.order, color: mode, default_color, colors, extra, svg },
    })
}

fn scan(dir: &Path) -> Result<Vec<Found>, ()> {
    let rd = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(()),
    };
    let mut found = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name();
        let Some(id) = name.to_str() else { continue };
        if !id_ok(id) { continue; }
        let path = entry.path();
        if !path.is_dir() { continue; }
        if let Some(pack) = accept(&path, id) { found.push(pack); }
    }
    found.sort_by(|a, b| a.info.order.cmp(&b.info.order).then(a.info.id.cmp(&b.info.id)));
    Ok(found)
}

pub fn list(dir: &Path) -> Vec<HatInfo> {
    scan(dir).unwrap_or_default().into_iter().map(|f| f.info).collect()
}

/// Empty hat clears colour and extra. An unknown id is cleared when `packs/` can be read
/// (a missing folder counts as no packs). A read error leaves a saved id alone.
pub fn clamp_saved(hat: &mut String, color: &mut String, extra: &mut bool, dir: &Path) -> bool {
    let before = (hat.clone(), color.clone(), *extra);
    if hat.is_empty() {
        color.clear();
        *extra = false;
    } else if let Ok(found) = scan(dir) {
        if let Some(rule) = found.iter().find(|f| f.rule.id == *hat).map(|f| &f.rule) {
            *color = match rule.mode {
                HatColorMode::Free => hex_ok(color).unwrap_or_else(|| rule.default_color.clone()),
                HatColorMode::Choice => {
                    let c = color.trim().to_ascii_lowercase();
                    if rule.choices.iter().any(|v| v == &c) { c } else { rule.default_color.clone() }
                }
            };
            if !rule.has_extra { *extra = false; }
        } else {
            hat.clear();
            color.clear();
            *extra = false;
        }
    }
    (hat.clone(), color.clone(), *extra) != before
}

pub fn packs_dir(state_path: &Path) -> PathBuf {
    state_path.parent().map(|d| d.join("packs")).unwrap_or_else(|| PathBuf::from("packs"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("lwc-hats-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn write_pack(root: &Path, id: &str, manifest: &str, svg: Option<&str>) {
        let d = root.join(id);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("manifest.json"), manifest).unwrap();
        if let Some(svg) = svg { std::fs::write(d.join("hat.svg"), svg).unwrap(); }
    }

    fn manifest(id: &str, color: &str, extra: &str) -> String {
        format!(r##"{{"id":"{id}","kind":"hat","name":"Name","minAppVersion":"0.6.2","color":"{color}","defaultColor":"#3d6b8a","files":["hat.svg"],"order":1{extra}}}"##)
    }

    #[test]
    fn real_supporter_hats_load_in_order() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../supporter/hats");
        let hats = list(&dir);
        let ids: Vec<_> = hats.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, ["beret", "beanie", "party", "cowboy", "cap"]);
        assert!(hats.iter().all(|h| h.svg.contains("lw-hat-front") && h.extra.is_none()));
        assert_eq!(hats[3].color, HatColorMode::Choice);
        assert_eq!(hats[3].colors.iter().map(|c| c.value.as_str()).collect::<Vec<_>>(), ["#241414", "#6e4527", "#f4f0ea"]);
        assert_eq!(hats[0].default_color, "#2f3a66");
        assert!(version_ok("0.7.0") && version_ok("0.6.2") && version_ok("0.6") && !version_ok("0.7.1") && !version_ok("99.0.0"));
    }

    #[test]
    fn rejects_bad_packs_and_clamps_colour() {
        let root = scratch("clamp");
        write_pack(&root, "cap", &manifest("cap", "free", ""), Some("<svg></svg>"));
        write_pack(&root, "cowboy", &format!(r##"{{"id":"cowboy","kind":"hat","name":"Cowboy","minAppVersion":"0.6.2","color":"choice","defaultColor":"#6e4527","colors":[{{"label":"Black","value":"#241414"}},{{"label":"Brown","value":"#6e4527"}},{{"label":"White","value":"#f4f0ea"}}],"files":["hat.svg"],"order":2}}"##), Some("<svg></svg>"));
        write_pack(&root, "nope", &manifest("other", "free", ""), Some("<svg></svg>"));
        write_pack(&root, "soon", &manifest("soon", "free", "").replace("0.6.2", "99.0.0"), Some("<svg></svg>"));
        write_pack(&root, "Bad", &manifest("Bad", "free", ""), Some("<svg></svg>"));
        write_pack(&root, "nofile", &manifest("nofile", "free", "").replace("hat.svg", "nope.svg"), Some("<svg></svg>"));
        let ids: Vec<_> = list(&root).into_iter().map(|h| h.id).collect();
        assert_eq!(ids, ["cap", "cowboy"]);

        let mut hat = "cap".into();
        let mut color = "#000000".into();
        let mut extra = true;
        assert!(clamp_saved(&mut hat, &mut color, &mut extra, &root));
        assert_eq!((hat.as_str(), color.as_str(), extra), ("cap", "#000000", false));

        hat = "cowboy".into(); color = "#FFFFFF".into(); extra = false;
        assert!(clamp_saved(&mut hat, &mut color, &mut extra, &root));
        assert_eq!(color, "#6e4527");
        hat = "cowboy".into(); color = "#241414".into();
        assert!(!clamp_saved(&mut hat, &mut color, &mut extra, &root));
        assert_eq!(color, "#241414");

        hat = "missing".into(); color = "#3d6b8a".into();
        assert!(clamp_saved(&mut hat, &mut color, &mut extra, &root));
        assert_eq!(hat, "");

        let missing = root.join("absent");
        hat = "ghost".into(); color = "#3d6b8a".into();
        assert!(clamp_saved(&mut hat, &mut color, &mut extra, &missing));
        assert_eq!(hat, "");

        let blocked = root.join("not-dir");
        std::fs::write(&blocked, "x").unwrap();
        hat = "ghost".into(); color = "#3d6b8a".into(); extra = true;
        assert!(!clamp_saved(&mut hat, &mut color, &mut extra, &blocked));
        assert_eq!((hat.as_str(), color.as_str(), extra), ("ghost", "#3d6b8a", true));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn old_save_has_no_hat() {
        let d: crate::store::Data = serde_json::from_str(r#"{"settings":{"buddy_name":"Inky"}}"#).unwrap();
        assert_eq!(d.settings.hat, "");
        assert_eq!(d.settings.hat_color, "");
        assert!(!d.settings.hat_extra);
        assert_eq!(d.settings.buddy_name, "Inky");
    }
}
