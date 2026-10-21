//! Settings "Check for update".
//! One GET, only when the user presses the button, to the public GitHub releases API.
//! The request sends no writing, project, or save data. Nothing is downloaded or installed.
//! The browser opens only the fixed download page, never an address from the response.

use std::io::Read;
use std::time::Duration;

const API: &str = "https://api.github.com/repos/Epic-Problem-Solver/Little-Author-Buddy/releases/latest";
pub const DOWNLOAD_PAGE: &str = "https://epic-problem-solver.github.io/Little-Author-Buddy/little-writer-companion/download/";
const BODY_MAX: u64 = 32 * 1024;

#[derive(serde::Serialize)]
pub struct UpdateStatus {
    pub current: String,
    pub latest: String,
    pub state: &'static str,
}

/// `major.minor.patch`, shorter forms pad with 0. A leading `v` is ignored.
/// Empty, more than three segments, a non-digit, or a segment longer than 6 digits is refused.
fn version_parts(raw: &str) -> Option<[u64; 3]> {
    let t = raw.trim();
    let t = t.strip_prefix('v').unwrap_or(t);
    let mut p = [0u64; 3];
    let bits: Vec<&str> = t.split('.').collect();
    if bits.is_empty() || bits.len() > 3 {
        return None;
    }
    for (i, b) in bits.iter().enumerate() {
        if b.is_empty() || !b.bytes().all(|c| c.is_ascii_digit()) || b.len() > 6 {
            return None;
        }
        p[i] = b.parse().ok()?;
    }
    Some(p)
}

fn display_version(raw: &str) -> String {
    let t = raw.trim();
    t.strip_prefix('v').unwrap_or(t).to_string()
}

pub(crate) fn judge(current: &str, tag: &str) -> Option<UpdateStatus> {
    let cur = version_parts(current)?;
    let lat = version_parts(tag)?;
    let state = if lat > cur {
        "newer"
    } else if lat < cur {
        "ahead"
    } else {
        "current"
    };
    Some(UpdateStatus { current: display_version(current), latest: display_version(tag), state })
}

/// The first `"tag_name"` string. Other fields, including any page address, are ignored.
fn tag_name(body: &str) -> Option<&str> {
    let key = "\"tag_name\"";
    let i = body.find(key)?;
    let rest = body[i + key.len()..].trim_start();
    let rest = rest.strip_prefix(':')?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    let tag = &rest[..end];
    if tag.is_empty() || tag.len() > 32 || tag.chars().any(|c| c.is_control() || c == '\\') {
        None
    } else {
        Some(tag)
    }
}

fn final_url_ok(url: &str) -> bool {
    const PREFIX: &str = "https://api.github.com/repos/Epic-Problem-Solver/Little-Author-Buddy/releases/";
    url.starts_with(PREFIX)
        && !url[PREFIX.len()..].contains("..")
        && !url.contains('@')
        && url.is_ascii()
        && !url.chars().any(|c| c.is_control())
}

fn reach(err: impl std::fmt::Display) -> String {
    eprintln!("check_update: {err}");
    "Couldn't reach GitHub.".into()
}

fn fetch_latest() -> Result<UpdateStatus, String> {
    let agent = ureq::AgentBuilder::new()
        .https_only(true)
        .redirects(3)
        .timeout(Duration::from_secs(12))
        .build();
    let resp = agent
        .get(API)
        .set("User-Agent", "Little-Author-Buddy")
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(reach)?;
    if !final_url_ok(resp.get_url()) {
        eprintln!("check_update: response was not the GitHub release");
        return Err("Couldn't reach GitHub.".into());
    }
    let mut buf = Vec::new();
    resp.into_reader().take(BODY_MAX).read_to_end(&mut buf).map_err(reach)?;
    let body = String::from_utf8_lossy(&buf);
    let tag = tag_name(&body).ok_or_else(|| "The latest release tag could not be read.".to_string())?;
    judge(env!("CARGO_PKG_VERSION"), tag).ok_or_else(|| "The latest release tag could not be read.".to_string())
}

#[tauri::command]
pub async fn check_update() -> Result<UpdateStatus, String> {
    match tauri::async_runtime::spawn_blocking(fetch_latest).await {
        Ok(result) => result,
        Err(e) => {
            eprintln!("check_update: {e}");
            Err("Couldn't reach GitHub.".into())
        }
    }
}

#[tauri::command]
pub fn open_download_page() -> Result<(), String> {
    open_browser()
}

#[cfg(windows)]
fn open_browser() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", DOWNLOAD_PAGE])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| {
            eprintln!("open_download_page: {e}");
            "Couldn't open the download page.".into()
        })
}

#[cfg(target_os = "macos")]
fn open_browser() -> Result<(), String> {
    std::process::Command::new("open").arg(DOWNLOAD_PAGE).spawn().map(|_| ()).map_err(|e| {
        eprintln!("open_download_page: {e}");
        "Couldn't open the download page.".into()
    })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_browser() -> Result<(), String> {
    std::process::Command::new("xdg-open").arg(DOWNLOAD_PAGE).spawn().map(|_| ()).map_err(|e| {
        eprintln!("open_download_page: {e}");
        "Couldn't open the download page.".into()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compare_release_tags() {
        assert_eq!(judge("0.7.0", "v0.7.1").unwrap().state, "newer");
        assert_eq!(judge("0.7.0", "v0.7.0").unwrap().state, "current");
        assert_eq!(judge("0.7.1", "v0.7.0").unwrap().state, "ahead");
        assert_eq!(judge("0.6", "v0.7.0").unwrap().state, "newer");
        assert_eq!(judge("0.10.0", "v0.9.0").unwrap().state, "ahead");
        let newer = judge("0.7.0", "v0.7.1").unwrap();
        assert_eq!(newer.current, "0.7.0");
        assert_eq!(newer.latest, "0.7.1");
        assert!(judge("0.7.0", "nope").is_none());
        assert!(judge("0.7.0", "1.2.3.4").is_none());
        assert!(judge("0.7.0", "v").is_none());
        assert!(judge("0.7.0", "v1234567.0.0").is_none());
        assert!(judge("", "v0.7.0").is_none());
    }

    #[test]
    fn reads_only_the_tag() {
        let body = r#"{"html_url":"https://evil.example/phish","tag_name":"v0.8.0","body":"notes"}"#;
        assert_eq!(tag_name(body), Some("v0.8.0"));
        let status = judge("0.7.0", tag_name(body).unwrap()).unwrap();
        assert_eq!(status.state, "newer");
        assert_eq!(status.latest, "0.8.0");
        assert_eq!(tag_name(r#"{"tag_name": "v0.7.0", "body": "cutoff"#), Some("v0.7.0"));
        assert_eq!(tag_name(r#"{"name":"nope"}"#), None);
        assert_eq!(tag_name(r#"{"tag_name":""}"#), None);
        assert_eq!(tag_name("{\"tag_name\":\"v0.7.0\\n\"}"), None);
    }

    #[test]
    fn release_url_stays_on_this_repo() {
        let ok = "https://api.github.com/repos/Epic-Problem-Solver/Little-Author-Buddy/releases/latest";
        assert!(final_url_ok(ok));
        assert!(final_url_ok("https://api.github.com/repos/Epic-Problem-Solver/Little-Author-Buddy/releases/123"));
        assert!(!final_url_ok("http://api.github.com/repos/Epic-Problem-Solver/Little-Author-Buddy/releases/latest"));
        assert!(!final_url_ok("https://api.github.com/repos/other/repo/releases/latest"));
        assert!(!final_url_ok("https://api.github.com.evil/repos/Epic-Problem-Solver/Little-Author-Buddy/releases/latest"));
        assert!(!final_url_ok("https://user:pass@api.github.com/repos/Epic-Problem-Solver/Little-Author-Buddy/releases/latest"));
        assert!(!final_url_ok("https://api.github.com/repos/Epic-Problem-Solver/Little-Author-Buddy/releases/latest/../../other"));
    }

    #[test]
    fn open_uses_the_download_page() {
        const SRC: &str = include_str!("update.rs");
        let code = SRC.split("\n#[cfg(test)]").next().unwrap();
        let i = code.find("fn open_download_page(").unwrap();
        let sig = &code[i..i + code[i..].find('{').unwrap()];
        assert!(sig.contains("open_download_page()"));
        assert!(!sig.contains("url"));
        assert!(code.contains(DOWNLOAD_PAGE));
        assert!(!code.contains("html_url"));
        let open = &code[code.find("fn open_browser(").unwrap()..];
        assert!(open.contains("DOWNLOAD_PAGE"));
        assert!(!open.contains("releases/latest"));
        assert!(DOWNLOAD_PAGE.ends_with("/little-writer-companion/download/"));
    }
}
