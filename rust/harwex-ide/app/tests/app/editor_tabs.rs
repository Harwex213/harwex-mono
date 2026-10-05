//! The editor tab strip: tabs wrap onto several rows, and the strip keeps at most
//! `TAB_LIMIT` tabs (the least recently used clean tab closes, Cmd+Shift+T brings it back).

use crate::common::*;
use egui::{Key, Rect, Vec2};
use harwex_ide::tabs::TAB_LIMIT;
use ide_editor::Position;

const SUITE: &str = "editor_tabs";

/// A repository with `count` text files, `src/f00.txt` and on; every third name is longer, so
/// the rows do not line up like a grid.
fn many_files_repo(fx: &Fixture, count: usize) -> Repo {
    let repo = basic_repo(fx.path("repo"));
    for i in 0..count {
        repo.write(&file_rel(i), &format!("file {i}\n"));
    }
    repo.commit_all("many files");
    repo
}

fn file_rel(i: usize) -> String {
    if i.is_multiple_of(3) {
        format!("src/f{i:02}_longer_name.txt")
    } else {
        format!("src/f{i:02}.txt")
    }
}

fn file_title(i: usize) -> String {
    file_rel(i).trim_start_matches("src/").to_string()
}

fn tab_rects(ide: &Ide) -> Vec<(String, Rect)> {
    ide.tab_titles().into_iter().map(|t| {
        let r = ide.rect(&format!("Tab {t}"));
        (t, r)
    }).collect()
}

/// Makes the tab of file `i` modified, without a save.
fn make_dirty(ide: &mut Ide, i: usize) {
    let path = std::fs::canonicalize(ide.root().join(file_rel(i))).expect("file exists");
    let tabs = &mut ide.state_mut().ws.tabs;
    let id = tabs.editor_by_path(&path).expect("tab is open");
    tabs.editor_mut(id).expect("editor tab").doc.replace(Position::new(0, 0), Position::new(0, 0), "edit ");
    ide.settle();
}

#[test]
fn tabs_wrap_into_rows_inside_the_editor() {
    let fx = Fixture::new(SUITE, "rows");
    let repo = many_files_repo(&fx, 30);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.resize(Vec2::new(900.0, 600.0));
    for i in 0..30 {
        ide.open_file(&file_rel(i));
    }
    assert_eq!(ide.tab_titles().len(), 30);

    let geo = ide.editor_geometry();
    let rects = tab_rects(&ide);
    let rows: std::collections::BTreeSet<i32> = rects.iter().map(|(_, r)| r.min.y.round() as i32).collect();
    assert!(rows.len() >= 3, "30 tabs in a narrow window need several rows, got {rows:?}");
    for (title, r) in &rects {
        assert!(r.min.x >= geo.gutter_rect.min.x - 1.0 && r.max.x <= geo.text_rect.max.x + 1.0, "{title} {r:?} sticks out of the editor {:?}", geo.text_rect);
        assert!(r.max.y <= geo.text_rect.min.y, "{title} {r:?} covers the text {:?}", geo.text_rect);
    }
    for (i, (a, ra)) in rects.iter().enumerate() {
        for (b, rb) in &rects[i + 1..] {
            assert!(!ra.intersects(rb.shrink(0.5)), "{a} {ra:?} overlaps {b} {rb:?}");
        }
    }
    ide.snapshot("rows");

    // A click on any tab, the active one or one in another row, moves no tab.
    let active = ide.active_title().expect("active tab");
    ide.click(&format!("Tab {active}"));
    ide.settle();
    assert_eq!(tab_rects(&ide), rects, "a click on the active tab moved tabs");
    ide.click(&format!("Tab {}", file_title(1)));
    ide.settle();
    assert_eq!(ide.active_title(), Some(file_title(1)));
    assert_eq!(tab_rects(&ide), rects, "a click on a first-row tab moved tabs");

    // Closing a tab re-flows the rows: the rest moves up to close the gap.
    ide.cmd(Key::W);
    ide.settle();
    let after = tab_rects(&ide);
    assert_eq!(after.len(), 29);
    assert_eq!(after[1].0, file_title(2));
    assert_eq!(after[1].1.min, rects[1].1.min, "the next tab takes the closed tab's place");
    ide.snapshot("rows_after_close");
}

#[test]
fn the_51st_tab_closes_the_least_recently_used_clean_tab() {
    let fx = Fixture::new(SUITE, "limit");
    let repo = many_files_repo(&fx, TAB_LIMIT + 2);
    let mut ide = Ide::open(SUITE, &repo.dir);
    for i in 0..TAB_LIMIT {
        ide.open_file(&file_rel(i));
    }
    assert_eq!(ide.tab_titles().len(), TAB_LIMIT);
    // f00 is the least recently used tab, but it is modified; f01 is next and clean.
    make_dirty(&mut ide, 0);
    ide.open_file(&file_rel(TAB_LIMIT));
    let titles = ide.tab_titles();
    assert_eq!(titles.len(), TAB_LIMIT);
    assert!(titles.contains(&file_title(0)), "a modified tab never closes by the limit");
    assert!(!titles.contains(&file_title(1)), "the least recently used clean tab closed");
    assert_eq!(ide.active_title(), Some(file_title(TAB_LIMIT)));

    // The closed tab comes back with Cmd+Shift+T, at its old place; that closes the next one.
    ide.cmd_shift(Key::T);
    let f01 = file_title(1);
    ide.wait_until("f01 reopened", move |ide| ide.active_title().as_deref() == Some(f01.as_str()));
    ide.settle();
    let titles = ide.tab_titles();
    assert_eq!(titles[1], file_title(1));
    assert_eq!(titles.len(), TAB_LIMIT);
    assert!(!titles.contains(&file_title(2)), "reopening over the limit closes the next least recently used tab");
}

#[test]
fn modified_tabs_exceed_the_limit_instead_of_closing() {
    let fx = Fixture::new(SUITE, "all_dirty");
    let repo = many_files_repo(&fx, TAB_LIMIT + 1);
    let mut ide = Ide::open(SUITE, &repo.dir);
    for i in 0..TAB_LIMIT {
        ide.open_file(&file_rel(i));
        make_dirty(&mut ide, i);
    }
    ide.open_file(&file_rel(TAB_LIMIT));
    assert_eq!(ide.tab_titles().len(), TAB_LIMIT + 1, "no modified tab closed");
    assert!(ide.state().ws.tabs.closed().is_empty());
    assert!(ide.state().ws.confirm_close.is_none(), "the limit asks nothing");
}
