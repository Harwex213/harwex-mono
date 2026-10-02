//! Runs navigation against a real file of the harwex-mono JS workspace and prints timings.
//!
//! cargo run -p ide-ts --example real_repo [file] [needle...]
//!
//! Read-only: files are opened in tsserver from disk and never written.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use ide_ts::TsService;

const DEFAULT_FILE: &str = "/Users/aleh_kaportsau/Projects/harwex-mono/javascript/packages/projects/harwex-notes/harwex-notes-frontend/src/ui/app.tsx";

fn main() {
    let mut args = std::env::args().skip(1);
    let file = PathBuf::from(args.next().unwrap_or_else(|| DEFAULT_FILE.to_string()));
    let mut needles: Vec<String> = args.collect();
    if needles.is_empty() {
        needles = ["useEffect", "TAppRegistry", "useSignals", "useStore"]
            .map(String::from)
            .to_vec();
    }
    let text = std::fs::read_to_string(&file).expect("read file");
    let ts = TsService::new();
    // The first request pays for project loading, which in a big workspace takes seconds.
    ts.set_timeout(Duration::from_secs(60));

    let started = Instant::now();
    ts.open(&file, &text);
    println!("open: {:?}", started.elapsed());

    for (round, needle) in needles.iter().enumerate() {
        let Some((line, column)) = find(&text, needle) else {
            println!("{needle}: not in file");
            continue;
        };
        let t = Instant::now();
        let def = ts.definition(&file, line, column);
        let def_time = t.elapsed();
        let t = Instant::now();
        let src = ts.source_definition(&file, line, column);
        let src_time = t.elapsed();
        println!("[{round}] {needle} at {}:{}", line + 1, column + 1);
        print_result("  definition", def_time, def);
        print_result("  source_definition", src_time, src);
    }

    // Same request again, now warm, to show the steady-state cost.
    if let Some((line, column)) = find(&text, &needles[0]) {
        for _ in 0..2 {
            let t = Instant::now();
            let def = ts.definition(&file, line, column);
            print_result(&format!("  repeat definition {}", needles[0]), t.elapsed(), def);
        }
        let t = Instant::now();
        let refs = ts.references(&file, line, column);
        println!("  references: {:?} -> {:?}", t.elapsed(), refs.map(|r| r.len()));
        let t = Instant::now();
        let info = ts.quick_info(&file, line, column);
        println!("  quick_info: {:?} -> {:?}", t.elapsed(), info.map(|i| i.map(|i| i.display)));
    }
    ts.shutdown();
}

fn print_result(label: &str, elapsed: Duration, result: ide_ts::Result<Vec<ide_ts::Location>>) {
    match result {
        Ok(locs) if locs.is_empty() => println!("{label}: {elapsed:?} -> nothing"),
        Ok(locs) => {
            for l in locs {
                println!("{label}: {elapsed:?} -> {}:{}:{}", l.path.display(), l.line + 1, l.column + 1);
            }
        }
        Err(e) => println!("{label}: {elapsed:?} -> error: {e}"),
    }
}

/// First occurrence of `needle`, as 0-based (line, char column).
fn find(text: &str, needle: &str) -> Option<(usize, usize)> {
    text.lines().enumerate().find_map(|(i, line)| {
        let at = line.find(needle)?;
        Some((i, line[..at].chars().count()))
    })
}
