//! Restart forgets the per-folder TypeScript lookup (task 126): a `typescript` installed after
//! a failed lookup (`yarn install` in a fresh worktree) is found after `restart`, not before.

use crate::common::{pos, service, single, symlink_dir, ts7, TsLink};

#[test]
fn restart_finds_typescript_installed_after_a_failed_lookup() {
    let Some(p) = crate::common::project(TsLink::Native) else { return };
    let link = p.root.join("node_modules/typescript");
    // A directory symlink is a file on unix and a directory on Windows.
    std::fs::remove_dir(&link).or_else(|_| std::fs::remove_file(&link)).unwrap();

    let ts = service();
    let (line, column) = pos(&p.main_text, "answer", 1);
    // A global `typescript` on this machine may serve the folder; the local one must not.
    let local = |ts: &ide_ts::TsService| ts.backend(&p.main).ok().and_then(|b| b.project_root);
    assert_eq!(local(&ts), None);
    if ts.backend(&p.main).is_err() {
        let err = ts.definition(&p.main, line, column).unwrap_err().to_string();
        assert!(err.contains("no node_modules/typescript above"), "{err}");
    }

    symlink_dir(ts7().unwrap(), &link).unwrap();
    assert_eq!(local(&ts), None, "the lookup is cached until a restart");
    ts.shutdown();
    assert_eq!(local(&ts), None, "shutdown keeps the lookup; only restart forgets it");

    ts.restart();
    assert_eq!(local(&ts), Some(p.root.clone()));
    ts.open(&p.main, &p.main_text);
    let loc = single(ts.definition(&p.main, line, column).unwrap());
    assert_eq!(loc.path, p.root.join("src/util.ts"));
    ts.shutdown();
}
