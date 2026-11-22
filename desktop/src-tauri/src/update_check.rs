use std::sync::Arc;

use anyhow::Context;
use log::{error, info};
use semver::Version;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::{Store, StoreExt};

const LATEST_VERSION_URL: &str = "https://about.transcribee.net/.latest_desktop_version";
const DOWNLOAD_PAGE_URL: &str = "https://about.transcribee.net/desktop";

const SKIP_VERSION_STORE_KEY: &str = "skip_version";

pub async fn check_for_update(app: &AppHandle) -> anyhow::Result<()> {
    let body = reqwest::get(LATEST_VERSION_URL).await?;
    let latest_version = body.text().await?;
    let local_version_str = app
        .config()
        .version
        .clone()
        .context("Could not get local version")?;
    let local_version = Version::parse(&local_version_str)?;
    let skipped_version = get_skipped_version(app)?;
    let latest_version = Version::parse(&latest_version)?;

    info!("Local version: {local_version}");
    info!("Skipped version: {skipped_version:?}");
    info!("Latest version: {latest_version}");

    let prompt_update = match skipped_version {
        Some(skipped_version) => latest_version > skipped_version,
        None => latest_version > local_version,
    };

    if prompt_update {
        show_update_available_dialog(app, latest_version, local_version);
    }

    Ok(())
}

fn show_update_available_dialog(app: &AppHandle, latest_version: Version, local_version: Version) {
    let open_dl_page_btn = "Open download page".to_string();
    let skip_version_btn = "Don't ask again for this version".to_string();
    let not_now_btn = "Not now".to_string();

    let app_clone = app.clone();

    app.dialog()
        .message(format!("A new version of transcribee is available: v{latest_version}\n\nYou are running v{local_version}.\n\nPlease download and install the new version."))
        .title("Transcribee Update Available")
        .buttons(
            tauri_plugin_dialog::MessageDialogButtons::YesNoCancelCustom(
                open_dl_page_btn.clone(),
                skip_version_btn.clone(),
                not_now_btn.clone(),
            ),
        ).show_with_result(move |dialog_result| {
            match dialog_result {
                tauri_plugin_dialog::MessageDialogResult::Custom(btn_text) => {
                    if btn_text == open_dl_page_btn {
                        if let Err(e) = app_clone.opener().open_url(DOWNLOAD_PAGE_URL, None::<&str>) {
                            error!("{e}");
                        }
                    } else if btn_text == skip_version_btn {
                        if let Err(e) = skip_version(&app_clone, latest_version) {
                            error!("Failed to set skip version: {e}");
                        }
                    } else if btn_text == not_now_btn {
                        // dismiss
                    } else {
                        error!("Unknown custom option received: {btn_text:?}");
                    }
                },
                _ => {
                    error!("Invalid option received: {dialog_result:?}");
                }
            }
        });
}

fn store<R: Runtime>(app: &AppHandle<R>) -> tauri_plugin_store::Result<Arc<Store<R>>> {
    app.store("update_check")
}

fn skip_version(app: &AppHandle, version: Version) -> anyhow::Result<()> {
    let _: () = store(app)?.set(SKIP_VERSION_STORE_KEY, version.to_string());
    Ok(())
}

fn get_skipped_version(app: &AppHandle) -> anyhow::Result<Option<Version>> {
    Ok(store(app)?
        .get(SKIP_VERSION_STORE_KEY)
        .as_ref()
        .and_then(|v| v.as_str())
        .map(Version::parse)
        .transpose()?)
}
