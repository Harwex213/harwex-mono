//! Try the editor widget alone: `cargo run -p ide-editor --release --example editor -- <file>`.
//! Cmd+S saves. Context-menu actions and hover positions show in the status bar.

use std::path::PathBuf;
use std::time::Instant;

use eframe::egui;
use ide_editor::{Document, EditorState, EditorView, GutterMark, Language};

struct App {
    doc: Document,
    state: EditorState,
    marks: Vec<(usize, GutterMark)>,
    status: String,
    hover: String,
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if ctx.input_mut(|i| i.consume_key(egui::Modifiers::COMMAND, egui::Key::S)) {
            self.status = match self.doc.save() {
                Ok(()) => "saved".into(),
                Err(e) => format!("save failed: {e}"),
            };
        }
        egui::TopBottomPanel::bottom("status").show(ctx, |ui| {
            ui.horizontal(|ui| {
                let c = self.state.cursor();
                ui.label(format!("{}:{}", c.line + 1, c.column + 1));
                ui.separator();
                ui.label(self.doc.language().name());
                ui.separator();
                ui.label(format!("{} lines{}", self.doc.line_count(), if self.doc.is_dirty() { " *" } else { "" }));
                ui.separator();
                ui.label(&self.hover);
                ui.separator();
                ui.label(&self.status);
            });
        });
        egui::CentralPanel::default().frame(egui::Frame::NONE).show(ctx, |ui| {
            let t = Instant::now();
            let r = EditorView::new(&mut self.doc, &mut self.state).gutter_marks(&self.marks).show(ui);
            let took = t.elapsed();
            if let Some(a) = r.action {
                self.status = format!("{a:?}");
            }
            if let Some(line) = r.gutter_clicked {
                self.status = format!("gutter click on line {}", line + 1);
            }
            self.hover = match r.hover {
                Some(p) => format!("hover {}:{}  frame {:.2} ms", p.line + 1, p.column + 1, took.as_secs_f64() * 1000.0),
                None => format!("frame {:.2} ms", took.as_secs_f64() * 1000.0),
            };
        });
    }
}

fn main() -> eframe::Result {
    let path = std::env::args().nth(1).map(PathBuf::from);
    let t = Instant::now();
    let doc = match &path {
        Some(p) => Document::open(p).unwrap_or_else(|e| {
            eprintln!("cannot open {}: {e}", p.display());
            std::process::exit(1);
        }),
        None => Document::from_text(SAMPLE, Language::TypeScript),
    };
    let open_ms = t.elapsed().as_secs_f64() * 1000.0;
    // Fake git marks so the gutter column is visible in the demo.
    let marks = vec![(1, GutterMark::Added), (2, GutterMark::Added), (5, GutterMark::Modified), (9, GutterMark::Deleted)];
    let mut state = EditorState::new();
    state.request_focus();
    let title = path.as_ref().map_or("ide-editor".to_string(), |p| p.display().to_string());
    eframe::run_native(
        &title,
        eframe::NativeOptions {
            viewport: egui::ViewportBuilder::default().with_inner_size([1200.0, 800.0]),
            ..Default::default()
        },
        Box::new(move |cc| {
            cc.egui_ctx.set_visuals(egui::Visuals::dark());
            Ok(Box::new(App { doc, state, marks, status: format!("opened in {open_ms:.1} ms"), hover: String::new() }))
        }),
    )
}

const SAMPLE: &str = r#"import { readFile } from "node:fs/promises";

/** A small sample shown when no file is given. */
export interface User {
  id: number;
  name: string;
}

export async function load(path: string): Promise<User[]> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text) as User[];
}

class Cache<T> {
  private items = new Map<string, T>();
  get(key: string): T | undefined {
    return this.items.get(key);
  }
}
"#;
