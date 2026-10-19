fn main() {
    #[cfg(feature = "benchmark")]
    if let Err(error) = withtype_windows_lib::benchmark::run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
    #[cfg(not(feature = "benchmark"))]
    {
        eprintln!("Build with --features benchmark");
        std::process::exit(2);
    }
}
