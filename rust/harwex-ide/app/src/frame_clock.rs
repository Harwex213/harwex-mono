//! The slow-frame guard (task 122). `IdeApp::update` times its big sections and every job
//! callback that `drain_inbox` runs. A frame longer than `slow_after` (1 s) logs one line with
//! the frame's time and its longest section, so a freeze report names its culprit without a
//! profiler. Cost per frame: one `Instant::now()` per section and per callback.

use std::time::{Duration, Instant};

/// A frame slower than `FrameClock::slow_after`.
#[derive(Clone, Debug)]
pub struct SlowFrame {
    pub took: Duration,
    /// The longest section: an `update` part (`"editor"`, `"tool window Commit"`) or a job
    /// callback's closure type (`harwex_ide::git::refresh::start_paths::{{closure}}`), which
    /// names the function that spawned the job.
    pub section: &'static str,
    pub section_took: Duration,
}

impl SlowFrame {
    pub fn line(&self) -> String {
        format!("slow frame: {:.0} ms, longest {} {:.0} ms", ms(self.took), self.section, ms(self.section_took))
    }
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

pub struct FrameClock {
    started: Option<Instant>,
    longest: Option<(&'static str, Duration)>,
    /// Frames above this are logged. Tests lower it.
    pub slow_after: Duration,
    /// The last slow frame, for tests.
    pub last_slow: Option<SlowFrame>,
}

impl Default for FrameClock {
    fn default() -> Self {
        FrameClock { started: None, longest: None, slow_after: Duration::from_secs(1), last_slow: None }
    }
}

impl FrameClock {
    pub fn begin(&mut self) {
        self.started = Some(Instant::now());
        self.longest = None;
    }

    /// Section `name` took `took`. Only the longest one is kept.
    pub fn note(&mut self, name: &'static str, took: Duration) {
        if self.longest.is_none_or(|(_, t)| took > t) {
            self.longest = Some((name, took));
        }
    }

    /// Ends the frame. Returns the frame when it was slow.
    pub fn end(&mut self) -> Option<SlowFrame> {
        let took = self.started.take()?.elapsed();
        if took <= self.slow_after {
            return None;
        }
        let (section, section_took) = self.longest.take().unwrap_or(("update", took));
        let slow = SlowFrame { took, section, section_took };
        self.last_slow = Some(slow.clone());
        Some(slow)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slow_frame_names_its_longest_section() {
        let mut c = FrameClock { slow_after: Duration::ZERO, ..Default::default() };
        c.begin();
        c.note("editor", Duration::from_millis(3));
        c.note("a::b::{{closure}}", Duration::from_millis(9));
        c.note("tree", Duration::from_millis(5));
        std::thread::sleep(Duration::from_millis(1));
        let slow = c.end().expect("slow");
        assert_eq!(slow.section, "a::b::{{closure}}");
        assert_eq!(slow.section_took, Duration::from_millis(9));
        assert!(slow.line().starts_with("slow frame: "), "{}", slow.line());

        let mut fast = FrameClock::default();
        fast.begin();
        fast.note("editor", Duration::from_millis(3));
        assert!(fast.end().is_none());
    }
}
