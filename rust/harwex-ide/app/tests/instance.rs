//! Single instance (`instance.rs`): a second launch hands its folder to the running IDE and
//! exits, and tests never touch the default socket. Every socket
//! here has its own name with the test process id, so the user's running IDE never sees it.

mod common;

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use common::*;
use harwex_ide::instance::{self, Claim, Request, Sent};
use harwex_ide::AppOptions;

const SUITE: &str = "instance";

/// A socket only this test uses. Never the default name.
fn test_socket(test: &str) -> PathBuf {
    let path = instance::socket_path(&format!("test-{}-{test}", std::process::id()));
    assert_ne!(path, instance::socket_path(instance::DEFAULT_NAME));
    let _ = std::fs::remove_file(&path);
    path
}

fn primary(path: &std::path::Path) -> instance::Server {
    match instance::claim(path, &Request::Activate, Duration::from_millis(500)) {
        Claim::Primary(server) => server,
        Claim::HandedOff => panic!("someone listens on {}", path.display()),
        Claim::Alone(why) => panic!("no socket: {why}"),
    }
}

/// Runs the real binary as a second launch and waits for it to exit.
fn second_launch(socket: &std::path::Path, args: &[&str]) -> (std::process::ExitStatus, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_harwex-ide"))
        .args(args)
        .env(instance::SOCKET_ENV, socket)
        // If the hand-off ever fails, the window that opens stays in the background.
        .env("HARWEX_IDE_BACKGROUND", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn harwex-ide");
    let deadline = Instant::now() + Duration::from_secs(20);
    let status = loop {
        if let Some(status) = child.try_wait().expect("wait") {
            break status;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("the second launch did not exit: it opened its own window");
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let mut err = String::new();
    std::io::Read::read_to_string(&mut child.stderr.take().expect("stderr"), &mut err).expect("read stderr");
    (status, err)
}

#[test]
fn second_launch_hands_off_and_exits() {
    let fx = Fixture::new(SUITE, "handoff");
    let first = basic_repo(fx.path("first"));
    let second = basic_repo(fx.path("second"));
    let socket = test_socket("handoff");
    let server = primary(&socket);
    let _cleanup = server.cleanup();
    let options = AppOptions { instance: Some(server), ..test_options(Some(&first.dir)) };
    let mut ide = Ide::with_options(SUITE, options, None);
    let first_root = std::fs::canonicalize(&first.dir).expect("canonical");
    ide.wait_for("first project", |s| s.ws.project.as_ref().is_some_and(|p| p.root == first_root));

    let (status, err) = second_launch(&socket, &[&second.dir.display().to_string()]);
    assert!(status.success(), "exit {status}: {err}");
    assert!(err.contains("handed over to the running instance"), "stderr: {err}");

    let second_root = std::fs::canonicalize(&second.dir).expect("canonical");
    ide.wait_for("second project opened and active", |s| s.ws.project.as_ref().is_some_and(|p| p.root == second_root));
    let roots: Vec<_> = ide.state().workspaces().into_iter().filter_map(|w| w.root).collect();
    assert_eq!(roots, vec![first_root.clone(), second_root.clone()]);

    // The same folder again only activates it: no third workspace.
    let first_id = ide.state().workspaces()[0].id;
    ide.state_mut().activate(first_id);
    ide.wait_for("first project active", |s| s.ws.project.as_ref().is_some_and(|p| p.root == first_root));
    let (status, err) = second_launch(&socket, &[&second.dir.display().to_string()]);
    assert!(status.success(), "exit {status}: {err}");
    ide.wait_for("second project active again", |s| s.ws.project.as_ref().is_some_and(|p| p.root == second_root));
    assert_eq!(ide.state().workspaces().len(), 2);
}

#[test]
fn request_without_folder_is_acked() {
    let fx = Fixture::new(SUITE, "activate");
    let repo = basic_repo(fx.path("repo"));
    let socket = test_socket("activate");
    let server = primary(&socket);
    let _cleanup = server.cleanup();
    let options = AppOptions { instance: Some(server), ..test_options(Some(&repo.dir)) };
    let mut ide = Ide::with_options(SUITE, options, None);
    ide.settle();
    let sent = instance::send(&socket, &Request::Activate, instance::ACK_TIMEOUT).expect("send");
    assert!(matches!(sent, Sent::Acked), "{sent:?}");
    ide.settle();
    assert_eq!(ide.state().workspaces().len(), 1);
}

#[test]
fn foreign_file_is_kept() {
    let socket = test_socket("foreign");
    std::fs::write(&socket, "not a socket").expect("write");
    match instance::claim(&socket, &Request::Activate, Duration::from_millis(500)) {
        Claim::Alone(_) => {}
        _ => panic!("a regular file must not become the socket"),
    }
    assert_eq!(std::fs::read_to_string(&socket).expect("read"), "not a socket");
    std::fs::remove_file(&socket).expect("remove");
}

#[test]
fn tests_never_listen_by_default() {
    assert!(test_options(None).instance.is_none());
    assert!(AppOptions::default().instance.is_none());
    // Background runs without `HARWEX_IDE_SOCKET` use no socket at all.
    assert_eq!(instance::socket_for(false, true, None), None);
}
