#![cfg_attr(not(windows), allow(dead_code))]
//! What `install` and `uninstall` change on Windows instead of the rc files and the `.app`:
//! the user PATH in the registry and a Start menu shortcut.
//!
//! xtask is std only, so the registry and the shortcut go through Windows PowerShell, which
//! every Windows has. Values reach the script through environment variables, never through
//! the script text, so no path needs quoting. The PATH arithmetic is pure and tested on every
//! platform.

use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::{Command, Stdio};

/// The registry key (under HKEY_CURRENT_USER) that holds the user environment.
pub const ENVIRONMENT: &str = "Environment";

/// `%LOCALAPPDATA%\Programs\harwex-ide`, where per-user apps live on Windows.
pub fn default_prefix(home: &Path) -> PathBuf {
    let local = std::env::var_os("LOCALAPPDATA").filter(|v| !v.is_empty()).map(PathBuf::from).unwrap_or_else(|| home.join("AppData").join("Local"));
    local.join("Programs").join(crate::BIN_NAME)
}

/// `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Harwex IDE.lnk`.
pub fn start_menu_shortcut(home: &Path) -> PathBuf {
    let roaming = std::env::var_os("APPDATA").filter(|v| !v.is_empty()).map(PathBuf::from).unwrap_or_else(|| home.join("AppData").join("Roaming"));
    roaming.join(r"Microsoft\Windows\Start Menu\Programs").join("Harwex IDE.lnk")
}

/// Windows compares PATH entries without case and ignores a trailing `\`.
fn same_dir(entry: &str, dir: &str) -> bool {
    let norm = |s: &str| s.trim().trim_end_matches(['\\', '/']).to_lowercase();
    norm(entry) == norm(dir)
}

/// The raw PATH value with `dir` appended, or `None` when it is already there. The other
/// entries stay byte for byte, `%VARIABLES%` included.
pub fn path_with(raw: &str, dir: &str) -> Option<String> {
    if raw.split(';').any(|e| same_dir(e, dir)) {
        return None;
    }
    let head = raw.trim_end_matches(';');
    Some(if head.is_empty() { dir.to_string() } else { format!("{head};{dir}") })
}

/// The raw PATH value without `dir`, or `None` when it is not there.
pub fn path_without(raw: &str, dir: &str) -> Option<String> {
    if !raw.split(';').any(|e| same_dir(e, dir)) {
        return None;
    }
    Some(raw.split(';').filter(|e| !same_dir(e, dir)).collect::<Vec<_>>().join(";"))
}

/// Runs a PowerShell script. `env` carries the values; stdout comes back as UTF-8.
#[cfg(windows)]
fn powershell(script: &str, env: &[(&str, &std::ffi::OsStr)]) -> Result<String, String> {
    let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| r"C:\Windows".into());
    let exe = system.join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
    let mut cmd = Command::new(&exe);
    // UTF-8 out, or a non-ASCII path comes back in the console code page.
    let script = format!("$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; {script}");
    cmd.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script]);
    cmd.envs(env.iter().copied()).stdin(Stdio::null());
    let out = cmd.output().map_err(|e| format!("cannot start {}: {e}", exe.display()))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(err.lines().find(|l| !l.trim().is_empty()).unwrap_or("powershell failed").trim().to_string())
    }
}

/// The callers branch on `cfg!(windows)` at run time, so the helpers exist everywhere.
#[cfg(not(windows))]
fn powershell(_script: &str, _env: &[(&str, &std::ffi::OsStr)]) -> Result<String, String> {
    Err("the registry and Start menu shortcuts exist only on Windows".to_string())
}

/// The raw (unexpanded) `Path` value of `HKCU\<key>`; empty when there is none.
pub fn read_user_path(key: &str) -> Result<String, String> {
    let script = "$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($env:HX_KEY); \
                  if ($k) { [Console]::Out.Write($k.GetValue('Path', '', 'DoNotExpandEnvironmentNames')) }";
    powershell(script, &[("HX_KEY", key.as_ref())])
}

/// Writes `Path` of `HKCU\<key>` as REG_EXPAND_SZ, like the Windows settings dialog does, so
/// entries such as `%USERPROFILE%\.cargo\bin` keep working. For the real environment key the
/// change is announced (`WM_SETTINGCHANGE`), so terminals started from now on see it: setting
/// any user variable through .NET sends that broadcast.
pub fn write_user_path(key: &str, value: &str) -> Result<(), String> {
    let mut script = String::from(
        "$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($env:HX_KEY); \
         $k.SetValue('Path', $env:HX_VALUE, [Microsoft.Win32.RegistryValueKind]::ExpandString); $k.Close();",
    );
    if key == ENVIRONMENT {
        script.push_str(
            " [Environment]::SetEnvironmentVariable('HARWEX_IDE_SETTINGCHANGE', '1', 'User');\
             [Environment]::SetEnvironmentVariable('HARWEX_IDE_SETTINGCHANGE', $null, 'User')",
        );
    }
    powershell(&script, &[("HX_KEY", key.as_ref()), ("HX_VALUE", value.as_ref())]).map(drop)
}

/// A `.lnk` that starts `target` in `work_dir`. The IDE takes a start in its own folder as a
/// launcher start and reopens the last project (`launch::startup_folder`).
pub fn create_shortcut(lnk: &Path, target: &Path, work_dir: &Path) -> Result<(), String> {
    if let Some(dir) = lnk.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    let script = "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:HX_LNK); \
                  $s.TargetPath = $env:HX_TARGET; $s.WorkingDirectory = $env:HX_DIR; \
                  $s.Description = 'Harwex IDE'; $s.Save()";
    powershell(script, &[("HX_LNK", lnk.as_os_str()), ("HX_TARGET", target.as_os_str()), ("HX_DIR", work_dir.as_os_str())]).map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_with_appends_once() {
        assert_eq!(path_with("", r"C:\x\bin").as_deref(), Some(r"C:\x\bin"));
        assert_eq!(path_with(r"%USERPROFILE%\.cargo\bin;C:\y;", r"C:\x\bin").as_deref(), Some(r"%USERPROFILE%\.cargo\bin;C:\y;C:\x\bin"));
        assert_eq!(path_with(r"C:\y;c:\X\BIN\", r"C:\x\bin"), None, "case and a trailing \\ do not matter");
    }

    #[test]
    fn path_without_keeps_the_rest_untouched() {
        assert_eq!(path_without(r"C:\y;C:\x\bin;%A%\z", r"C:\x\bin").as_deref(), Some(r"C:\y;%A%\z"));
        assert_eq!(path_without(r"C:\x\bin", r"c:\x\bin\").as_deref(), Some(""));
        assert_eq!(path_without(r"C:\y", r"C:\x\bin"), None);
    }

    #[test]
    fn default_locations_are_per_user() {
        let home = Path::new(r"C:\Users\u");
        assert!(default_prefix(home).ends_with(r"Programs\harwex-ide"));
        assert!(start_menu_shortcut(home).ends_with(r"Start Menu\Programs\Harwex IDE.lnk"));
    }

    /// Writes and reads a throwaway key, never the real environment:
    /// `cargo test -p xtask -- --ignored registry_round_trip`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn registry_round_trip() {
        let key = r"Software\harwex-ide-xtask-test";
        let value = r"%USERPROFILE%\.cargo\bin;C:\Programme\Übung";
        write_user_path(key, value).unwrap();
        assert_eq!(read_user_path(key).unwrap(), value, "unexpanded and UTF-8");
        powershell("[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($env:HX_KEY)", &[("HX_KEY", key.as_ref())]).unwrap();
        assert_eq!(read_user_path(key).unwrap(), "");
    }

    #[cfg(windows)]
    #[test]
    fn shortcut_points_at_the_binary() {
        let dir = std::env::temp_dir().join(format!("xtask-lnk-{}", std::process::id()));
        let lnk = dir.join("Test IDE.lnk");
        let target = dir.join("bin").join("harwex-ide.exe");
        create_shortcut(&lnk, &target, &dir.join("bin")).unwrap();
        let read = powershell("[Console]::Out.Write((New-Object -ComObject WScript.Shell).CreateShortcut($env:HX_LNK).TargetPath)", &[("HX_LNK", lnk.as_os_str())]).unwrap();
        assert_eq!(read, target.display().to_string());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
