//! Supporter mini-games. The pack is a manifest plus `game.json` (the lines Buddy speaks).
//! Chase and tag run inside the app. Pack scripts are never executed.

use crate::packs;
use serde::{Deserialize, Serialize};
use std::path::Path;

const TEXT_MAX: usize = 160;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct GameInfo {
    pub id: String,
    pub name: String,
    pub order: i32,
    pub explain: String,
    pub cheer: String,
    pub away: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct FocusSay {
    pub kind: &'static str,
    pub game: String,
    pub text: String,
}

#[derive(Deserialize)]
struct Manifest {
    id: String,
    kind: String,
    name: String,
    #[serde(rename = "minAppVersion")]
    min_app_version: String,
    engine: String,
    files: Vec<String>,
    #[serde(default)]
    order: i32,
}

#[derive(Deserialize)]
struct Lines {
    explain: String,
    cheer: String,
    #[serde(default)]
    away: String,
}

fn line(raw: &str, required: bool) -> Option<String> {
    let t: String = raw.chars().filter(|c| !c.is_control()).take(TEXT_MAX).collect();
    let t = t.trim().to_string();
    if t.is_empty() { if required { None } else { Some(String::new()) } } else { Some(t) }
}

fn builtin(id: &str) -> (&'static str, &'static str, &'static str) {
    if id == "tag" {
        ("Ooh! {buddy} runs from the cursor. Click {buddy}.", "You got {buddy}!", "Ooh! {buddy} got away.")
    } else {
        ("Ooh! {buddy} chases the cursor. A catch gets a cheer.", "{buddy} caught it!", "Ooh! Too quick for {buddy}.")
    }
}

fn accept(dir: &Path, id: &str) -> Option<GameInfo> {
    if id != "chase" && id != "tag" { return None; }
    let raw = packs::read_regular(&dir.join("manifest.json"), 8 * 1024)?;
    let m: Manifest = serde_json::from_str(&raw).ok()?;
    if m.id != id || m.kind != "game" || m.engine != id { return None; }
    if m.files != ["game.json".to_string()] { return None; }
    if !packs::version_ok(&m.min_app_version) { return None; }
    let name = packs::clean_label(&m.name)?;
    let body = packs::read_regular(&dir.join("game.json"), 8 * 1024)?;
    let lines: Lines = serde_json::from_str(&body).ok()?;
    Some(GameInfo {
        id: id.into(),
        name,
        order: m.order,
        explain: line(&lines.explain, true)?,
        cheer: line(&lines.cheer, true)?,
        away: line(&lines.away, false)?,
    })
}

pub fn list(dir: &Path) -> Vec<GameInfo> {
    let rd = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return Vec::new(),
    };
    let mut found = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name();
        let Some(id) = name.to_str() else { continue };
        if !packs::id_ok(id) { continue; }
        let path = entry.path();
        if !path.is_dir() { continue; }
        if let Some(game) = accept(&path, id) { found.push(game); }
    }
    found.sort_by(|a, b| a.order.cmp(&b.order).then(a.id.cmp(&b.id)));
    found
}

pub fn known(dir: &Path, id: &str) -> bool { list(dir).iter().any(|g| g.id == id) }

fn fill_buddy(raw: &str, buddy: &str) -> String {
    let name = buddy.trim();
    let name = if name.is_empty() { "Inky" } else { name };
    raw.replace("{buddy}", name)
}

/// Invite text stays empty so the window can pick a focus-break line. Explain and away come from the pack.
pub fn say_event(kind: crate::focus::Kind, game: &str, buddy: &str, dir: &Path) -> FocusSay {
    let text = match kind {
        crate::focus::Kind::Invite => String::new(),
        crate::focus::Kind::Explain => {
            let raw = list(dir).into_iter().find(|g| g.id == game).map(|g| g.explain)
                .unwrap_or_else(|| builtin(game).0.to_string());
            fill_buddy(&raw, buddy)
        }
        crate::focus::Kind::Away => {
            let raw = list(dir).into_iter().find(|g| g.id == game).map(|g| g.away).filter(|s| !s.is_empty())
                .unwrap_or_else(|| builtin(game).2.to_string());
            fill_buddy(&raw, buddy)
        }
    };
    FocusSay { kind: kind.as_str(), game: game.to_string(), text }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("lwc-games-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn write_game(root: &Path, id: &str, manifest: &str, body: Option<&str>) {
        let d = root.join(id);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("manifest.json"), manifest).unwrap();
        if let Some(body) = body { std::fs::write(d.join("game.json"), body).unwrap(); }
    }

    #[test]
    fn real_games_load_in_order() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../supporter/games");
        let games = list(&dir);
        let ids: Vec<_> = games.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(ids, ["chase", "tag"]);
        assert!(games.iter().all(|g| g.explain.contains("Ooh!") && g.explain.contains("{buddy}") && !g.cheer.is_empty()));
        assert!(crate::packs::list(&dir).is_empty(), "a game folder is not a hat");
    }

    #[test]
    fn rejects_unknown_engines_and_extra_files() {
        let root = scratch("reject");
        let ok = r#"{"id":"chase","kind":"game","name":"Chase","minAppVersion":"0.6.2","engine":"chase","order":1,"files":["game.json"]}"#;
        let lines = r#"{"explain":"Ooh! {buddy} chases.","cheer":"Got it!","away":"Ooh!"}"#;
        write_game(&root, "chase", ok, Some(lines));
        write_game(&root, "tag", &ok.replace("chase", "tag"), Some(lines));
        write_game(&root, "soon", &ok.replace("chase", "soon").replace("0.6.2", "99.0.0"), Some(lines));
        write_game(&root, "nope", &ok.replace("chase", "nope"), Some(lines));
        write_game(&root, "script", &ok.replace("chase", "script").replace("game.json", "game.js"), Some(lines));
        let hat = r##"{"id":"beret","kind":"hat","name":"Beret","minAppVersion":"0.6.2","color":"free","defaultColor":"#3d6b8a","files":["hat.svg"]}"##;
        write_game(&root, "beret", hat, None);
        std::fs::write(root.join("beret").join("hat.svg"), "<svg></svg>").unwrap();
        let ids: Vec<_> = list(&root).into_iter().map(|g| g.id).collect();
        assert_eq!(ids, ["chase", "tag"]);
        let hats: Vec<_> = crate::packs::list(&root).into_iter().map(|h| h.id).collect();
        assert_eq!(hats, ["beret"]);
        let _ = std::fs::remove_dir_all(&root);
    }
}
