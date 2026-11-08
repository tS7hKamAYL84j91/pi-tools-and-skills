use pi_shared_hub::host::{CallFailure, Host};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
#[test]
fn known_not_started_is_distinct_from_post_spawn_uncertainty() {
    let stop = Arc::new(AtomicBool::new(false));
    let host = Host {
        executable: "/definitely-not-an-executable/pi-hub-fixture".into(),
        session: "fixture".into(),
        stop: stop.clone(),
    };
    assert_eq!(
        host.run(&[], Duration::from_secs(1)),
        Err(CallFailure::NotStarted)
    );
    let host = Host {
        executable: "/usr/bin/false".into(),
        session: "fixture".into(),
        stop: stop.clone(),
    };
    assert_eq!(
        host.run(&[], Duration::from_secs(1)),
        Err(CallFailure::MayHaveRun)
    );
    stop.store(true, Ordering::Relaxed);
    assert_eq!(
        host.run(&[], Duration::from_secs(1)),
        Err(CallFailure::NotStarted)
    );
}
