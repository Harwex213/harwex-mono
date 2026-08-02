//! Standalone crop helper. Every agent uses it to cut comparison crops out of both
//! `docs/wheel_stage.png` and the renders.
//!
//! Owner: agent F.
//!
//! ```text
//! cargo run --release --bin crop -- <in.png> <out.png> <x> <y> <w> <h>
//! ```
//!
//! `x, y` is the **top-left** corner and y grows downward, matching the crop table in
//! `docs/agent_plan.md` and the pixel coordinates of the reference image. The output is
//! written as PNG regardless of the extension given.

use std::path::Path;
use std::process::ExitCode;

const USAGE: &str = "usage: crop <in.png> <out.png> <x> <y> <w> <h>\n\
                     \n\
                     x,y is the top-left corner of the region and y grows downward.";

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        println!("{USAGE}");
        return Ok(());
    }
    if args.len() != 6 {
        return Err(format!("expected 6 arguments, got {}\n{USAGE}", args.len()).into());
    }

    let input = Path::new(&args[0]);
    let output = Path::new(&args[1]);
    let x = parse(&args[2], "x")?;
    let y = parse(&args[3], "y")?;
    let width = parse(&args[4], "w")?;
    let height = parse(&args[5], "h")?;
    if width == 0 || height == 0 {
        return Err("w and h must both be greater than zero".into());
    }

    let source = image::open(input)?;
    let (iw, ih) = (source.width(), source.height());
    if x + width > iw || y + height > ih {
        return Err(format!(
            "region {x},{y} {width}x{height} does not fit in {}, which is {iw}x{ih}",
            input.display()
        )
        .into());
    }

    let cropped = image::imageops::crop_imm(&source, x, y, width, height).to_image();
    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    cropped.save(output)?;
    println!(
        "wrote {} ({}x{})",
        output.display(),
        cropped.width(),
        cropped.height()
    );
    Ok(())
}

fn parse(value: &str, name: &str) -> Result<u32, Box<dyn std::error::Error>> {
    value
        .parse::<u32>()
        .map_err(|e| format!("{name}: {value:?} is not a non-negative integer ({e})").into())
}
