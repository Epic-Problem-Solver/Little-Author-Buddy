//! Distraction policy. Title match, then media, then scroll. No I/O.

pub struct Policy {
    pub detect_titles: bool,
    pub detect_media: bool,
    pub detect_scroll: bool,
    pub titles: Vec<String>,
    pub scroll_events_threshold: u32,
}

/// `title` is the foreground window title, already excluding this app.
pub fn reason(policy: &Policy, title: Option<&str>, media: bool, scrolls: u64) -> Option<String> {
    if policy.detect_titles {
        if let Some(title) = title {
            let lower = title.to_lowercase();
            if let Some(hit) = policy.titles.iter().find(|d| !d.is_empty() && lower.contains(&d.to_lowercase())) {
                return Some(format!("title:{hit}"));
            }
        }
    }
    if policy.detect_media && media { return Some("media".into()); }
    if policy.detect_scroll && scrolls >= policy.scroll_events_threshold as u64 { return Some("scroll".into()); }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> Policy {
        Policy {
            detect_titles: true, detect_media: true, detect_scroll: true,
            titles: vec!["YouTube".into()], scroll_events_threshold: 12,
        }
    }

    #[test]
    fn title_beats_media_and_scroll() {
        let p = policy();
        assert_eq!(reason(&p, Some("YouTube - Chrome"), true, 40).as_deref(), Some("title:YouTube"));
        assert_eq!(reason(&p, Some("Notes"), true, 40).as_deref(), Some("media"));
        assert_eq!(reason(&p, Some("Notes"), false, 40).as_deref(), Some("scroll"));
        assert!(reason(&p, Some("Notes"), false, 11).is_none());
    }
}
