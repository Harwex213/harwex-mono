//! The editor tab strip: tabs wrap onto several rows, and the strip keeps at most
//! `TAB_LIMIT` tabs (the least recently used clean tab closes, Cmd+Shift+T brings it back).

use crate::common::*;
use egui::{Key, Pos2, Rect, Vec2};
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

// ---------------------------------------------------------------------------------------------
// The tab menu's close actions (task 075)

/// Opens files `0..count` in strip order; the last one is active.
fn open_files(ide: &mut Ide, count: usize) -> Vec<String> {
    for i in 0..count {
        ide.open_file(&file_rel(i));
    }
    let titles: Vec<String> = (0..count).map(file_title).collect();
    assert_eq!(ide.tab_titles(), titles);
    titles
}

/// Right-clicks the tab `title` and picks `item` in its menu.
fn menu_close(ide: &mut Ide, title: &str, item: &str) {
    ide.right_click(&format!("Tab {title}"));
    ide.settle();
    ide.click(item);
    ide.settle();
}

/// Reopens the closed tabs with Cmd+Shift+T, one press per tab, and checks the order.
fn reopen_in_order(ide: &mut Ide, titles: &[&str]) {
    for title in titles {
        ide.cmd_shift(Key::T);
        let t = title.to_string();
        ide.wait_until(&format!("{title} reopened"), move |ide| ide.active_title().as_deref() == Some(t.as_str()));
        ide.settle();
    }
}

#[test]
fn close_others_from_the_menu_of_an_inactive_tab() {
    let fx = Fixture::new(SUITE, "close_others");
    let repo = many_files_repo(&fx, 4);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let titles = open_files(&mut ide, 4);
    assert_eq!(ide.active_title().as_deref(), Some(titles[3].as_str()));

    // The menu acts on the clicked tab, not the active one; a right click activates nothing.
    ide.right_click(&format!("Tab {}", titles[1]));
    ide.settle();
    assert_eq!(ide.active_title().as_deref(), Some(titles[3].as_str()));
    for item in ["Close", "Close Others", "Close All", "Close Tabs to the Left", "Close Tabs to the Right", "Close Unmodified"] {
        assert!(ide.is_enabled(item), "{item} is enabled");
    }
    ide.snapshot("tab_menu");
    ide.click("Close Others");
    ide.settle();
    assert_eq!(ide.tab_titles(), [titles[1].clone()]);
    assert_eq!(ide.active_title().as_deref(), Some(titles[1].as_str()));
    assert!(ide.state().ws.close_batch.is_none());

    // With one tab left, Close Others and both sides would close nothing.
    ide.right_click(&format!("Tab {}", titles[1]));
    ide.settle();
    assert!(!ide.is_enabled("Close Others"));
    assert!(!ide.is_enabled("Close Tabs to the Left"));
    assert!(!ide.is_enabled("Close Tabs to the Right"));
    assert!(ide.is_enabled("Close All"));
    ide.key(Key::Escape);
    ide.settle();

    // Cmd+Shift+T brings the closed tabs back one by one, the last closed first, each at its
    // old place.
    reopen_in_order(&mut ide, &[&titles[3], &titles[2], &titles[0]]);
    assert_eq!(ide.tab_titles(), titles);
}

#[test]
fn close_all_left_right_and_unmodified() {
    let fx = Fixture::new(SUITE, "close_scopes");
    let repo = many_files_repo(&fx, 6);
    // f04 has a git change (no unsaved edit): Close Unmodified keeps it, like IDEA.
    repo.write(&file_rel(4), "changed on disk\n");
    let mut ide = Ide::open(SUITE, &repo.dir);
    let titles = open_files(&mut ide, 6);

    menu_close(&mut ide, &titles[2], "Close Tabs to the Left");
    assert_eq!(ide.tab_titles(), &titles[2..]);
    menu_close(&mut ide, &titles[4], "Close Tabs to the Right");
    assert_eq!(ide.tab_titles(), &titles[2..5]);
    // The first tab has nothing on its left, the last nothing on its right.
    ide.right_click(&format!("Tab {}", titles[2]));
    ide.settle();
    assert!(!ide.is_enabled("Close Tabs to the Left"));
    assert!(ide.is_enabled("Close Tabs to the Right"));
    ide.key(Key::Escape);
    ide.settle();

    // Close Unmodified keeps the tab with unsaved edits (f03) and the one with a git change
    // (f04), and closes the rest, a diff tab too (custom tabs get the same menu).
    make_dirty(&mut ide, 3);
    let changed = ide.root().join(file_rel(4));
    harwex_ide::git::diff::open_worktree_diff(ide.state_mut(), &changed);
    ide.wait_until("diff tab", |ide| ide.state().is_idle() && ide.tab_titles().len() == 4);
    ide.settle();
    let diff_title = ide.active_title().expect("diff tab active");
    assert!(ide.state().ws.tabs.active_tab().is_some_and(|t| t.editor().is_none()), "the diff is a custom tab");
    menu_close(&mut ide, &diff_title, "Close Unmodified");
    assert_eq!(ide.tab_titles(), &titles[3..5]);
    assert!(ide.state().ws.confirm_close.is_none(), "Close Unmodified asks nothing");
    ide.right_click(&format!("Tab {}", titles[3]));
    ide.settle();
    assert!(!ide.is_enabled("Close Unmodified"), "every tab left is modified");
    ide.key(Key::Escape);
    ide.settle();

    // Close All asks about the dirty f03 first (strip order); f04 closes after the answer.
    menu_close(&mut ide, &titles[4], "Close All");
    assert_eq!(ide.tab_titles(), &titles[3..5]);
    ide.assert_text(&format!("Save changes to {}?", titles[3]));
    ide.click("Don't Save");
    ide.settle();
    assert!(ide.tab_titles().is_empty());
    assert!(ide.state().ws.close_batch.is_none());
}

#[test]
fn alt_click_on_the_close_button_closes_the_others() {
    let fx = Fixture::new(SUITE, "alt_close");
    let repo = many_files_repo(&fx, 3);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let titles = open_files(&mut ide, 3);
    // The close button sits at the tab's right end (`tabs::tab_button`).
    let r = ide.rect(&format!("Tab {}", titles[0]));
    let close = egui::pos2(r.max.x - 6.0 - 8.0, r.center().y);
    ide.click_button_at(close, egui::PointerButton::Primary, egui::Modifiers::ALT);
    ide.settle();
    assert_eq!(ide.tab_titles(), [titles[0].clone()]);
    assert_eq!(ide.active_title().as_deref(), Some(titles[0].as_str()));
    reopen_in_order(&mut ide, &[&titles[2], &titles[1]]);
    assert_eq!(ide.tab_titles(), titles);

    // Without Alt the same press closes only that tab.
    let r = ide.rect(&format!("Tab {}", titles[0]));
    ide.click_at(egui::pos2(r.max.x - 6.0 - 8.0, r.center().y));
    ide.settle();
    assert_eq!(ide.tab_titles(), &titles[1..]);
}

#[test]
fn menu_close_asks_about_each_dirty_tab_like_cmd_w() {
    let fx = Fixture::new(SUITE, "close_dirty");
    let repo = many_files_repo(&fx, 4);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let titles = open_files(&mut ide, 4);
    make_dirty(&mut ide, 0);
    make_dirty(&mut ide, 2);

    // Tabs close in strip order; the dirty f00 asks first and holds the rest.
    menu_close(&mut ide, &titles[3], "Close All");
    assert_eq!(ide.tab_titles(), titles);
    ide.assert_text(&format!("Save changes to {}?", titles[0]));
    ide.click("Save");
    ide.wait_for("f00 saved and closed", |s| s.ws.confirm_close.is_some_and(|id| s.ws.tabs.get(id).is_some_and(|t| t.title() == "f02.txt")) && s.ws.tabs.list.len() == 2);
    ide.settle();
    assert!(repo.read(&file_rel(0)).starts_with("edit file 0"), "Save wrote f00");
    // f01 closed without a question; f02 asks now. Cancel stops the rest of the batch.
    assert_eq!(ide.tab_titles(), &titles[2..]);
    ide.assert_text(&format!("Save changes to {}?", titles[2]));
    ide.click("Cancel");
    ide.settle();
    assert_eq!(ide.tab_titles(), &titles[2..]);
    assert!(ide.state().ws.close_batch.is_none());
    assert!(ide.state().ws.confirm_close.is_none());

    // Close Others from f03: f02 asks, Don't Save closes it and keeps the disk file.
    menu_close(&mut ide, &titles[3], "Close Others");
    ide.click("Don't Save");
    ide.settle();
    assert_eq!(ide.tab_titles(), [titles[3].clone()]);
    assert_eq!(ide.active_title().as_deref(), Some(titles[3].as_str()));
    assert_eq!(repo.read(&file_rel(2)), "file 2\n");
}

// ---------------------------------------------------------------------------------------------
// Reorder by drag (task 077)

/// Presses the primary button at `from` and moves to `to` in six frames, past egui's drag
/// threshold. The button stays down.
fn press_and_move(ide: &mut Ide, from: Pos2, to: Pos2) {
    ide.move_to(from);
    ide.pointer_frame(1.0 / 60.0, &[(from, true)]);
    for i in 1..=6 {
        ide.move_to(from + (to - from) * (i as f32 / 6.0));
    }
}

fn release(ide: &mut Ide, at: Pos2) {
    ide.pointer_frame(1.0 / 60.0, &[(at, false)]);
    ide.settle();
}

/// Where the tab's grab point (12 pt from its left edge) must go so that the floating tab's
/// middle sits at `center` (`tabs::drop_slot` reads the middle).
fn pointer_for(tab: Rect, center: Pos2) -> Pos2 {
    center + Vec2::new(12.0 - tab.width() / 2.0, 0.0)
}

fn grab(tab: Rect) -> Pos2 {
    Pos2::new(tab.min.x + 12.0, tab.center().y)
}

fn dragging(ide: &Ide) -> bool {
    ide.state().ws.tabs.dragging().is_some()
}

#[test]
fn drag_moves_a_tab_after_the_third() {
    let fx = Fixture::new(SUITE, "drag_reorder");
    let repo = many_files_repo(&fx, 4);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let t = open_files(&mut ide, 4);
    let rects: Vec<Rect> = tab_rects(&ide).into_iter().map(|(_, r)| r).collect();
    assert!(rects.iter().all(|r| (r.center().y - rects[0].center().y).abs() < 0.5), "one row: {rects:?}");

    // The floating tab's middle between the middles of the third and the fourth tab.
    let mid = Pos2::new((rects[2].center().x + rects[3].center().x) / 2.0, rects[0].center().y);
    let to = pointer_for(rects[0], mid);
    press_and_move(&mut ide, grab(rects[0]), to);
    assert!(dragging(&ide), "the move past the threshold started a drag");
    assert_eq!(ide.tab_titles(), t, "nothing moves before the release");
    assert_eq!(ide.active_title().as_deref(), Some(t[0].as_str()), "the press activated the dragged tab");
    ide.snapshot_here("tab_drag_marker");

    release(&mut ide, to);
    assert!(!dragging(&ide));
    assert_eq!(ide.tab_titles(), [t[1].as_str(), t[2].as_str(), t[0].as_str(), t[3].as_str()]);
    assert_eq!(ide.active_title().as_deref(), Some(t[0].as_str()), "the dragged tab stays active");

    // Close Tabs to the Right and Cmd+Shift+T follow the new order.
    menu_close(&mut ide, &t[0], "Close Tabs to the Right");
    assert_eq!(ide.tab_titles(), [t[1].as_str(), t[2].as_str(), t[0].as_str()]);
    reopen_in_order(&mut ide, &[&t[3]]);
    assert_eq!(ide.tab_titles(), [t[1].as_str(), t[2].as_str(), t[0].as_str(), t[3].as_str()]);
}

#[test]
fn drag_moves_a_tab_into_another_row() {
    let fx = Fixture::new(SUITE, "drag_rows");
    let repo = many_files_repo(&fx, 30);
    let mut ide = Ide::open(SUITE, &repo.dir);
    ide.resize(Vec2::new(900.0, 600.0));
    let t = open_files(&mut ide, 30);
    let rects: Vec<Rect> = tab_rects(&ide).into_iter().map(|(_, r)| r).collect();
    // The second tab of the third row.
    let row_tops: std::collections::BTreeSet<i32> = rects.iter().map(|r| r.min.y.round() as i32).collect();
    let third = *row_tops.iter().nth(2).expect("three rows");
    let k = rects.iter().position(|r| r.min.y.round() as i32 == third).expect("third row") + 1;
    assert_eq!(rects[k].min.y.round() as i32, third, "the third row holds two tabs");

    // The middle lands at the left edge of tab k: the tab goes between k - 1 and k.
    let to = pointer_for(rects[0], Pos2::new(rects[k].min.x, rects[k].center().y));
    press_and_move(&mut ide, grab(rects[0]), to);
    assert!(dragging(&ide));
    release(&mut ide, to);
    let mut want: Vec<String> = t[1..k].to_vec();
    want.push(t[0].clone());
    want.extend_from_slice(&t[k..]);
    assert_eq!(ide.tab_titles(), want);
    assert_eq!(ide.active_title().as_deref(), Some(t[0].as_str()));
}

#[test]
fn escape_or_a_far_release_cancels_the_drag() {
    let fx = Fixture::new(SUITE, "drag_cancel");
    let repo = many_files_repo(&fx, 3);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let t = open_files(&mut ide, 3);
    let rects: Vec<Rect> = tab_rects(&ide).into_iter().map(|(_, r)| r).collect();
    let to = pointer_for(rects[0], Pos2::new(rects[2].max.x, rects[2].center().y));

    // Escape puts the tab back; the release afterwards changes nothing.
    press_and_move(&mut ide, grab(rects[0]), to);
    assert!(dragging(&ide));
    ide.key(Key::Escape);
    assert!(!dragging(&ide), "Escape ended the drag");
    release(&mut ide, to);
    assert_eq!(ide.tab_titles(), t, "Escape cancelled the move");

    // A release far below the strip (over the text) cancels too.
    let away = Pos2::new(to.x, to.y + 200.0);
    press_and_move(&mut ide, grab(rects[0]), to);
    ide.move_to(away);
    assert!(dragging(&ide));
    release(&mut ide, away);
    assert!(!dragging(&ide));
    assert_eq!(ide.tab_titles(), t, "a release away from the strip cancelled the move");
}

#[test]
fn a_click_without_movement_only_activates() {
    let fx = Fixture::new(SUITE, "drag_click");
    let repo = many_files_repo(&fx, 3);
    let mut ide = Ide::open(SUITE, &repo.dir);
    let t = open_files(&mut ide, 3);
    let r = ide.rect(&format!("Tab {}", t[0]));
    // A tiny wobble stays under egui's drag threshold: a click, not a drag.
    let p = grab(r);
    press_and_move(&mut ide, p, p + Vec2::new(2.0, 0.0));
    assert!(!dragging(&ide));
    release(&mut ide, p + Vec2::new(2.0, 0.0));
    assert_eq!(ide.tab_titles(), t);
    assert_eq!(ide.active_title().as_deref(), Some(t[0].as_str()), "the click activated the first tab");
    // The close button still closes on a press, and middle-click still closes.
    ide.click_at(Pos2::new(r.max.x - 6.0 - 8.0, r.center().y));
    ide.settle();
    assert_eq!(ide.tab_titles(), &t[1..]);
    let r = ide.rect(&format!("Tab {}", t[1]));
    ide.click_button_at(r.center(), egui::PointerButton::Middle, egui::Modifiers::NONE);
    ide.settle();
    assert_eq!(ide.tab_titles(), &t[2..]);
}

#[test]
fn the_new_order_survives_a_restart() {
    let fx = Fixture::new(SUITE, "drag_restore");
    let repo = many_files_repo(&fx, 3);
    let mut storage = MemoryStorage::default();
    let t = {
        let mut ide = Ide::open(SUITE, &repo.dir);
        let t = open_files(&mut ide, 3);
        let rects: Vec<Rect> = tab_rects(&ide).into_iter().map(|(_, r)| r).collect();
        let to = pointer_for(rects[2], rects[0].center() - Vec2::new(4.0, 0.0));
        press_and_move(&mut ide, grab(rects[2]), to);
        assert!(dragging(&ide));
        release(&mut ide, to);
        assert_eq!(ide.tab_titles(), [t[2].as_str(), t[0].as_str(), t[1].as_str()]);
        eframe::App::save(ide.harness.state_mut(), &mut storage);
        t
    };
    let mut ide = Ide::with_options(SUITE, test_options(Some(&repo.dir)), Some(&storage));
    let want = vec![t[2].clone(), t[0].clone(), t[1].clone()];
    let w = want.clone();
    ide.wait_until("tabs restored", move |ide| ide.tab_titles() == w);
    assert_eq!(ide.active_title().as_deref(), Some(t[2].as_str()));
}
