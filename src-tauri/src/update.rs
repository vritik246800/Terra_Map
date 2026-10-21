//! Update notice (Fase 14, `Q_LIST.md` Q29): is the latest GitHub release
//! newer than this build, and open its download page.
//!
//! The frontend fetches the release tag (the core has no HTTP client); the
//! version comparison and the URL live here. The URL is fixed — the frontend
//! never chooses what gets opened.

use std::process::Command;

use crate::error::AppError;

/// Download page of the latest release.
pub const RELEASES_URL: &str = "https://github.com/vritik246800/Terra_Map/releases/latest";

/// `v1.2.3` / `1.2.3` → `[1, 2, 3]`; anything else (pre-releases, junk) → `None`.
fn parse(version: &str) -> Option<[u64; 3]> {
    let numbers = version
        .trim()
        .trim_start_matches(['v', 'V'])
        .split('.')
        .map(|n| n.parse().ok());
    numbers.collect::<Option<Vec<u64>>>()?.try_into().ok()
}

/// Is the release `tag` newer than `current` (this build)? Unparsable → false.
pub fn is_newer(tag: &str, current: &str) -> bool {
    matches!((parse(tag), parse(current)), (Some(latest), Some(current)) if latest > current)
}

/// Opens `RELEASES_URL` in the default browser.
pub fn open_releases_page() -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(windows)]
    let mut cmd = Command::new("rundll32"); // GUI launcher: no console window
    #[cfg(windows)]
    cmd.arg("url.dll,FileProtocolHandler");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = Command::new("xdg-open");
    let status = cmd.arg(RELEASES_URL).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(format!("could not open the browser ({status})")).into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_newer_tags_count() {
        assert!(is_newer("v0.2.0", "0.1.0"));
        assert!(is_newer("0.1.1", "0.1.0"));
        assert!(is_newer("v1.0.0", "0.9.9"));
        assert!(is_newer("v0.10.0", "0.9.0")); // numbers, not text order
        assert!(!is_newer("v0.1.0", "0.1.0"));
        assert!(!is_newer("v0.0.9", "0.1.0"));
        // Pre-releases, junk and partial versions never show the notice.
        for tag in ["v0.2.0-beta", "latest", "", "v1.2", "v1.2.3.4", "v-1.0.0"] {
            assert!(!is_newer(tag, "0.1.0"), "{tag}");
        }
    }
}
