#[cfg(target_os = "wasi")]
include!("plugin.rs");

#[cfg(not(target_os = "wasi"))]
fn main() {
    eprintln!("Build this view for wasm32-wasip1; run pi-hub-index natively. See README.md.");
    std::process::exit(2);
}
