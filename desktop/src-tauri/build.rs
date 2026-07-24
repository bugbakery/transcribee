use std::{
    fs::{create_dir_all, remove_dir_all},
    process::Command,
};

use tauri_build::is_dev;

fn main() {
    // in dev mode we simply start the worker from ../../worker with uv while in production
    // we use the bundled worker. We still need to create an empty worker/ dir in dev to make
    // the tauri build process happy.
    if is_dev() {
        let _ = remove_dir_all("worker");
        create_dir_all("worker").expect("could not create worker/ dir");
    } else {
        Command::new("python")
            .args(["src-tauri/prepare_worker.py"])
            .output()
            .expect("failed to build worker bundle");
    }
    tauri_build::build()
}
