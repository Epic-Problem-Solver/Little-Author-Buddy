//! Supporter mini-games. The pack is a manifest plus `game.json` (the lines Buddy speaks).
//! Chase, tag, red light, high five, and warmer run inside the app. Pack scripts are never executed.

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

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct GameCard {
    pub id: String,
    pub name: String,
    pub blurb: String,
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

pub const ENGINES: [&str; 5] = ["chase", "tag", "redlight", "highfive", "warmer"];

pub fn known(id: &str) -> bool { ENGINES.contains(&id) }

fn engine_ok(id: &str) -> bool { known(id) }

pub fn builtin_name(id: &str) -> &'static str {
    match id {
        "tag" => "Tag the Buddy",
        "redlight" => "Red Light Green Light",
        "highfive" => "High Five",
        "warmer" => "Hide and Seek",
        _ => "Chase the Mouse",
    }
}

/// Tag, high five, and warmer need a click on Buddy. The overlay stays click-through.
pub fn wants_hit(id: &str) -> bool {
    matches!(id, "tag" | "highfive" | "warmer")
}

fn builtin(id: &str) -> (&'static str, &'static str, &'static str) {
    match id {
        "tag" => ("Ooh! {buddy} runs from the cursor. Click {buddy}.", "You got {buddy}!", "Ooh! {buddy} got away."),
        "redlight" => ("Ooh! Sneak closer while {buddy} faces away. Hold still when {buddy} looks.", "You made it!", "Ooh! {buddy} is still looking."),
        "highfive" => ("Ooh! Click {buddy} while the happy face shows. Three in a row.", "High five!", "Ooh! {buddy} put the hand down."),
        "warmer" => ("Ooh! Find {buddy} by the window. Warmer, then colder, then a click.", "You found {buddy}!", "Ooh! {buddy} stayed hidden."),
        _ => ("Ooh! {buddy} chases the cursor. A catch gets a cheer.", "{buddy} caught it!", "Ooh! Too quick for {buddy}."),
    }
}

fn accept(dir: &Path, id: &str) -> Option<GameInfo> {
    if !engine_ok(id) { return None; }
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

/// Every engine, with the installed pack's name and explanation when that pack is present.
pub fn catalog(dir: &Path, buddy: &str) -> Vec<GameCard> {
    let installed = list(dir);
    ENGINES.iter().map(|id| {
        if let Some(g) = installed.iter().find(|g| g.id == *id) {
            GameCard { id: g.id.clone(), name: g.name.clone(), blurb: fill_buddy(&g.explain, buddy) }
        } else {
            GameCard { id: (*id).into(), name: builtin_name(id).into(), blurb: fill_buddy(builtin(id).0, buddy) }
        }
    }).collect()
}

fn fill_buddy(raw: &str, buddy: &str) -> String {
    let name = buddy.trim();
    let name = if name.is_empty() { crate::store::DEFAULT_BUDDY } else { name };
    raw.replace("{buddy}", name)
}

/// Ask and the decline are fixed here so a missing flavour line cannot drop them.
/// Explain is the pack line plus the click instruction. Away comes from the pack.
/// `minutes` is the finished sprint, already rounded. A sprint prompt asks about another one.
pub fn say_event(kind: crate::focus::Kind, game: &str, buddy: &str, dir: &Path, prompt: crate::focus::Prompt, minutes: u32) -> FocusSay {
    let text = match kind {
        crate::focus::Kind::Invite => String::new(),
        crate::focus::Kind::Sprint => "Okay. Another sprint.".to_string(),
        crate::focus::Kind::Ask if prompt == crate::focus::Prompt::Sprint => {
            "Want to do another sprint? Press Y for yes, or N for no.".to_string()
        }
        crate::focus::Kind::Ask => {
            let n = minutes.max(1);
            let unit = if n == 1 { "minute" } else { "minutes" };
            format!("You wrote for {n} {unit}! Want to play a game? Press Y for yes, or N for no.")
        }
        crate::focus::Kind::Explain => {
            let raw = list(dir).into_iter().find(|g| g.id == game).map(|g| g.explain)
                .unwrap_or_else(|| builtin(game).0.to_string());
            let mut text = fill_buddy(&raw, buddy);
            text.push_str(" Click when you're ready.");
            text
        }
        crate::focus::Kind::Decline => fill_buddy("Okay. {buddy} understands. Back to the writing.", buddy),
        crate::focus::Kind::Away => {
            let raw = list(dir).into_iter().find(|g| g.id == game).map(|g| g.away).filter(|s| !s.is_empty())
                .unwrap_or_else(|| builtin(game).2.to_string());
            fill_buddy(&raw, buddy)
        }
        crate::focus::Kind::Suggest => {
            if game.is_empty() {
                "Ooh! Time for a game!".to_string()
            } else {
                let name = list(dir).into_iter().find(|g| g.id == game).map(|g| g.name)
                    .unwrap_or_else(|| builtin_name(game).to_string());
                format!("Ooh! How about {name}?")
            }
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
        assert_eq!(ids, ["chase", "tag", "redlight", "highfive", "warmer"]);
        assert!(games.iter().all(|g| g.explain.contains("Ooh!") && g.explain.contains("{buddy}") && !g.cheer.is_empty()));
        assert!(crate::packs::list(&dir).is_empty(), "a game folder is not a hat");
        for roll in 0..20u64 {
            let id = crate::focus::choose_id(&games.iter().map(|g| g.id.clone()).collect::<Vec<_>>(), roll).unwrap();
            assert!(ids.contains(&id.as_str()));
        }
    }

    #[test]
    fn ask_and_decline_are_fixed_and_explain_asks_for_a_click() {
        let dir = scratch("say");
        let ask = say_event(crate::focus::Kind::Ask, "chase", "Buddy", &dir, crate::focus::Prompt::Game, 30);
        assert_eq!(ask.text, "You wrote for 30 minutes! Want to play a game? Press Y for yes, or N for no.");
        let one = say_event(crate::focus::Kind::Ask, "chase", "Buddy", &dir, crate::focus::Prompt::Game, 1);
        assert_eq!(one.text, "You wrote for 1 minute! Want to play a game? Press Y for yes, or N for no.");
        let again = say_event(crate::focus::Kind::Ask, "", "Buddy", &dir, crate::focus::Prompt::Sprint, 30);
        assert_eq!(again.text, "Want to do another sprint? Press Y for yes, or N for no.");
        let started = say_event(crate::focus::Kind::Sprint, "", "Buddy", &dir, crate::focus::Prompt::Sprint, 30);
        assert_eq!(started.text, "Okay. Another sprint.");
        let no = say_event(crate::focus::Kind::Decline, "chase", "Ada", &dir, crate::focus::Prompt::Game, 0);
        assert_eq!(no.text, "Okay. Ada understands. Back to the writing.");
        let ex = say_event(crate::focus::Kind::Explain, "chase", "Buddy", &dir, crate::focus::Prompt::Game, 30);
        assert!(ex.text.contains("Buddy"));
        assert!(ex.text.ends_with("Click when you're ready."));
        let bare = say_event(crate::focus::Kind::Suggest, "", "Ada", &dir, crate::focus::Prompt::Game, 0);
        assert_eq!(bare.text, "Ooh! Time for a game!");
        let named = say_event(crate::focus::Kind::Suggest, "redlight", "Ada", &dir, crate::focus::Prompt::Game, 0);
        assert_eq!(named.text, "Ooh! How about Red Light Green Light?");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn catalog_lists_every_engine_and_prefers_a_pack_name() {
        let root = scratch("catalog");
        let cards = catalog(&root, "Ada");
        assert_eq!(cards.len(), 5);
        assert_eq!(cards.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["chase", "tag", "redlight", "highfive", "warmer"]);
        assert_eq!(cards[0].name, "Chase the Mouse");
        assert!(cards[0].blurb.contains("Ada"));
        assert!(!cards[0].blurb.contains("{buddy}"));
        let ok = r#"{"id":"tag","kind":"game","name":"Tag","minAppVersion":"0.6.2","engine":"tag","order":2,"files":["game.json"]}"#;
        let lines = r#"{"explain":"Ooh! {buddy} runs.","cheer":"Got it!"}"#;
        write_game(&root, "tag", ok, Some(lines));
        let cards = catalog(&root, "Ada");
        let tag = cards.iter().find(|c| c.id == "tag").unwrap();
        assert_eq!(tag.name, "Tag");
        assert_eq!(tag.blurb, "Ooh! Ada runs.");
        let say = say_event(crate::focus::Kind::Suggest, "tag", "Ada", &root, crate::focus::Prompt::Game, 0);
        assert_eq!(say.text, "Ooh! How about Tag?");
        let _ = std::fs::remove_dir_all(&root);
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
