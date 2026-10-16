//! A patch of uncommitted changes (the Commit window's Create Patch and Copy as Patch).

use std::path::PathBuf;

use crate::cli::{arg_chunks, literal_pathspec, Run};
use crate::{Repo, Result};

/// Which part of a file's local change goes into the patch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LocalChange {
    /// Index vs HEAD.
    Staged,
    /// Worktree vs index.
    Unstaged,
    /// Worktree vs HEAD: a partly staged file taken as a whole.
    Both,
    /// A new file that git does not track.
    Untracked,
}

/// One file of a local patch. `old_path` is the HEAD side of a staged rename; with it the
/// patch moves the file instead of adding a copy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalPatchFile {
    pub path: PathBuf,
    pub old_path: Option<PathBuf>,
    pub change: LocalChange,
}

/// A unified patch in `git diff --binary` format, so `git apply` takes it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LocalPatch {
    pub bytes: Vec<u8>,
    /// Files in the patch (a rename counts once). A file with no content change is left out.
    pub files: usize,
}

/// Files per git run: a selection of thousands of files stays under the OS argument limit.
const CHUNK: usize = 500;

/// An upper bound of a file's pathspec length: the given path may be absolute while the spec
/// is relative; plus `:(literal)`, a space and quotes per side of a rename.
fn spec_len(f: &&LocalPatchFile) -> usize {
    std::iter::once(&f.path).chain(&f.old_path).map(|p| p.as_os_str().len() + 13).sum()
}

/// Options every patch run forces: user config (textconv, an external diff, `diff.noprefix`,
/// `diff.relative`) would make the patch unappliable.
const PATCH_ARGS: &[&str] = &["diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/"];

impl Repo {
    /// The patch of local changes. Each file appears once, with the part `change` names.
    /// Untracked files come as new files (`/dev/null` to the file). Paths are relative to the
    /// workdir with `a/` and `b/` prefixes. The files are sorted by their `diff --git` line.
    pub fn local_patch(&self, files: &[LocalPatchFile]) -> Result<LocalPatch> {
        let head = {
            let repo = self.open()?;
            let head = repo.head().ok().and_then(|h| h.target());
            match head {
                Some(oid) => oid.to_string(),
                // An unborn branch: every tracked file is new.
                None => crate::selection::empty_tree_id()?.to_string(),
            }
        };
        let mut out = Vec::new();
        for (change, base) in [(LocalChange::Staged, Some("--cached")), (LocalChange::Unstaged, None), (LocalChange::Both, Some(head.as_str()))] {
            let class: Vec<&LocalPatchFile> = files.iter().filter(|f| f.change == change).collect();
            for chunk in arg_chunks(&class, CHUNK, spec_len) {
                let specs: Vec<String> = chunk
                    .iter()
                    .flat_map(|f| std::iter::once(&f.path).chain(&f.old_path))
                    .map(|p| literal_pathspec(&self.rel(p)))
                    .collect();
                let mut args: Vec<&str> = PATCH_ARGS.to_vec();
                // Renames are found only inside one run, so both sides of a rename share a chunk.
                args.extend(["-M", "--no-relative"]);
                args.extend(base);
                args.push("--");
                args.extend(specs.iter().map(String::as_str));
                let (outcome, bytes) = self.git_run(&args, Run::default())?;
                outcome.into_result()?;
                out.extend(split_files(&bytes));
            }
        }
        for f in files.iter().filter(|f| f.change == LocalChange::Untracked) {
            let rel = crate::git_path(&self.rel(&f.path));
            let mut args: Vec<&str> = PATCH_ARGS.to_vec();
            args.extend(["--no-index", "--", "/dev/null", rel.as_str()]);
            let (outcome, bytes) = self.git_run(&args, Run::default())?;
            // `--no-index` exits 1 when the files differ, which is always the case here.
            if outcome.code != Some(1) {
                outcome.into_result()?;
            }
            out.extend(split_files(&bytes));
        }
        out.sort();
        out.dedup();
        Ok(LocalPatch { files: out.len(), bytes: out.concat() })
    }
}

/// Cuts a `git diff` output into one piece per file. A piece starts at a `diff --git ` line;
/// no other line of a patch can start so (content lines start with ` `, `+`, `-` or `\`, and
/// base85 has no space).
fn split_files(bytes: &[u8]) -> Vec<Vec<u8>> {
    const HEAD: &[u8] = b"diff --git ";
    let mut starts: Vec<usize> = Vec::new();
    let mut line = 0;
    while line < bytes.len() {
        if bytes[line..].starts_with(HEAD) {
            starts.push(line);
        }
        line = match bytes[line..].iter().position(|&b| b == b'\n') {
            Some(n) => line + n + 1,
            None => bytes.len(),
        };
    }
    starts.iter().enumerate().map(|(i, &s)| bytes[s..starts.get(i + 1).copied().unwrap_or(bytes.len())].to_vec()).collect()
}

#[cfg(test)]
mod tests {
    use super::split_files;

    #[test]
    fn splits_at_file_headers_only() {
        let text = b"diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-diff --git no\n+a\ndiff --git a/y b/y\nnew file mode 100644\n";
        let parts = split_files(text);
        assert_eq!(parts.len(), 2);
        assert!(parts[0].ends_with(b"+a\n"));
        assert!(parts[1].starts_with(b"diff --git a/y"));
        assert!(split_files(b"").is_empty());
    }
}
