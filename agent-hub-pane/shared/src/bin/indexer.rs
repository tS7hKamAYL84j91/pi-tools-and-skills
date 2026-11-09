#[cfg(not(target_os = "wasi"))]
fn main() {
    let result = pi_shared_hub::publisher::Config::parse(std::env::args().skip(1))
        .and_then(pi_shared_hub::publisher::run);
    if let Err(error) = result {
        eprintln!("Hub indexer: {error}");
        std::process::exit(2);
    }
}
#[cfg(target_os = "wasi")]
fn main() {
    eprintln!("The indexer must run natively, not in WASI");
}
