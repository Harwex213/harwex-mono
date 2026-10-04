//! Stale socket recovery (`instance::claim`). It has its own test binary: a child that another
//! test forks inherits the dropped listener's fd until its `exec`, and a connect in that window
//! looks like a live instance that answers nothing.

use std::os::unix::net::{UnixListener, UnixStream};
use std::time::Duration;

use harwex_ide::instance::{self, Claim, Request, Sent};

#[test]
fn stale_socket_is_replaced() {
    let socket = instance::socket_path(&format!("test-{}-stale", std::process::id()));
    assert_ne!(socket, instance::socket_path(instance::DEFAULT_NAME));
    let _ = std::fs::remove_file(&socket);
    // A crashed instance leaves its socket file behind with nobody listening.
    drop(UnixListener::bind(&socket).expect("bind"));
    assert!(socket.exists());
    let sent = instance::send(&socket, &Request::Activate, instance::ACK_TIMEOUT);
    assert!(matches!(sent, Ok(Sent::NoListener)), "{sent:?}");

    let server = match instance::claim(&socket, &Request::Activate, Duration::from_millis(500)) {
        Claim::Primary(server) => server,
        Claim::HandedOff => panic!("someone listens on {}", socket.display()),
        Claim::Alone(why) => panic!("no socket: {why}"),
    };
    assert!(UnixStream::connect(&socket).is_ok(), "the new instance listens");
    let cleanup = server.cleanup();
    drop(server);
    drop(cleanup);
    assert!(!socket.exists(), "the socket file goes away with the instance");
}
