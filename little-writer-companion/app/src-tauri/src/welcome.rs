//! One welcome when a newer build opens a desk that was already set up.
//! The notes live in this file. The window does not use the network.
//!
//! An empty or unreadable `seen_version` on an onboarded save shows every note
//! up through the running version, once. A stored older version shows only the
//! notes after it. The same version, or a newer one, stays quiet, and a
//! downgrade does not rewrite the stored version. A first run stays in
//! onboarding and records the version when that finishes.

use crate::update::version_parts;
use serde::Serialize;

struct Note {
    version: &'static str,
    lines: &'static [&'static str],
}

/// Oldest first. A version with no entry still opens the welcome, with no list.
const NOTES: &[Note] = &[
    Note {
        version: "0.7.0",
        lines: &[
            "The desk has a sprint timer. Start begins it, and Pause holds it.",
            "Hats and games load from a packs folder next to the save. They are not in the installer.",
        ],
    },
    Note {
        version: "0.8.0",
        lines: &[
            "After fifteen minutes of writing at the desk, Buddy suggests a game and keeps typing. Falling asleep, wandering, or watching starts that wait over.",
            "Red Light Green Light, High Five, and Hide and Seek are new games. They are not in the installer.",
            "The games button beside the gear lists each game. Play starts one.",
            "Settings can check for a newer release. The check sends nothing you wrote, and it does not download the update.",
        ],
    },
];

#[derive(Clone, Serialize)]
pub struct Section {
    pub version: String,
    pub lines: Vec<String>,
}

#[derive(Serialize)]
pub struct View {
    pub buddy: String,
    pub sections: Vec<Section>,
}

/// `Some` means open the welcome and then store `current`.
/// `Some` with an empty list is a newer build that has no written notes yet.
pub fn pending(seen: &str, onboarded: bool, current: &str) -> Option<Vec<Section>> {
    if !onboarded {
        return None;
    }
    let cur = version_parts(current)?;
    let floor = match version_parts(seen) {
        Some(seen_v) if seen_v >= cur => return None,
        Some(seen_v) => Some(seen_v),
        None => None,
    };
    let sections = NOTES
        .iter()
        .filter_map(|n| {
            let v = version_parts(n.version)?;
            if v > cur {
                return None;
            }
            if let Some(seen_v) = floor {
                if v <= seen_v {
                    return None;
                }
            }
            Some(Section {
                version: n.version.to_string(),
                lines: n.lines.iter().map(|l| (*l).to_string()).collect(),
            })
        })
        .collect();
    Some(sections)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn versions(seen: &str, current: &str) -> Option<Vec<String>> {
        pending(seen, true, current).map(|s| s.into_iter().map(|n| n.version).collect())
    }

    #[test]
    fn first_run_stays_in_onboarding() {
        assert!(pending("", false, "0.8.0").is_none());
        assert!(pending("0.6.2", false, "0.8.0").is_none());
    }

    #[test]
    fn a_save_with_no_version_hears_every_note() {
        assert_eq!(versions("", "0.8.0").unwrap(), vec!["0.7.0", "0.8.0"]);
        assert_eq!(versions("beta", "0.8.0").unwrap(), vec!["0.7.0", "0.8.0"]);
    }

    #[test]
    fn a_jump_hears_only_the_notes_after_the_saved_version() {
        assert_eq!(versions("0.6.2", "0.8.0").unwrap(), vec!["0.7.0", "0.8.0"]);
        assert_eq!(versions("0.7.0", "0.8.0").unwrap(), vec!["0.8.0"]);
        assert_eq!(versions("v0.7.0", "0.8.0").unwrap(), vec!["0.8.0"]);
    }

    #[test]
    fn the_same_version_and_a_downgrade_stay_quiet() {
        assert!(versions("0.8.0", "0.8.0").is_none());
        assert!(versions("0.9.0", "0.8.0").is_none());
    }

    #[test]
    fn a_newer_build_with_no_written_notes_still_welcomes() {
        let notes = pending("0.8.0", true, "0.9.0").unwrap();
        assert!(notes.is_empty());
    }
}
