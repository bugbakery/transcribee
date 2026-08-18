use std::{
    env,
    fs::{create_dir_all, remove_dir_all},
    process::Command,
};

use tauri_build::is_dev;

fn main() {
    println!("cargo::rerun-if-env-changed=DEP_TAURI_DEV"); // ensures this is rerun if `is_dev()` return value changes
    println!("cargo::rerun-if-changed=prepare_worker.py");

    // in dev mode we simply start the worker from ../../worker with uv while in production
    // we use the bundled worker. We still need to create an empty worker/ dir in dev to make
    // the tauri build process happy.
    if is_dev() || env::var_os("DONT_BUNDLE_WORKER").is_some() {
        let _ = remove_dir_all("worker");
        create_dir_all("worker").expect("could not create worker/ dir");
    } else {
        let cmd = Command::new("python")
            .args(["prepare_worker.py"])
            .output()
            .expect("failed to build worker bundle");

        if !cmd.status.success() {
            println!(
                "cargo::error=prepare_worker.py failed with exit code {}",
                cmd.status
                    .code()
                    .map_or("<unknown>".to_string(), |c| c.to_string())
            );

            for line in String::from_utf8(cmd.stderr).unwrap().lines() {
                println!("cargo::error={}", line);
            }
        }
    }
    tauri_build::build()
}
