//! documents in transcribee desktop go through different phases:
//! they are created as _new_ documents that live in our appdata folder. when they are in this phase
//! they do not contain an embedded media file but we store the media separately. For _new_ files we
//! store the media path and the displayname separately in our state.
//! When the user first saves the file, we show them a file picker so that they can select where
//! to store the file. They then become _mature_ files that have the media embedded.
//! For _mature_ documents, the media file is embedded and we derive the display name from the
//! file name.

use crate::cmd_error::CmdResult;
use crate::http_partial_content::http_response_maybe_partial;
use crate::transcribee_archive::{self, MediaFileSource};
use crate::window::focused_window;
use anyhow::{anyhow, bail, Result};
use log::warn;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs::{self, remove_file};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use tauri::path::BaseDirectory;
use tauri::{command, ipc::Response};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_store::StoreExt;
use tokio::sync::oneshot;
use uuid::Uuid;
use worker_adapter::WorkerAdapter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: Uuid,

    /// this is the working copy of the document where we put all changes as they occur.
    /// this ID is also used as the main identifyer to of the document
    pub app_data_path: String,

    /// this is the path under which the user explicitly saved their document. We only write this
    /// when explicitly instructed to do so.
    #[serde(default)]
    pub save_path: Option<String>,

    #[serde(default)]
    pub tasks: Vec<Uuid>,
    #[serde(default)]
    pub transcription_progress: f32,

    #[serde(default)]
    pub media_files: Vec<MediaFile>,

    #[serde(default)]
    pub has_unsaved_changes: bool,
}
impl Document {
    pub fn display_name(&self) -> String {
        let original_media_file = self
            .media_files
            .iter()
            .find(|media_file| media_file.tags.iter().any(|tag| tag == "original"));
        let original_media_file_path = match original_media_file {
            Some(MediaFile {
                source: MediaFileSource::Fs { media_path },
                ..
            }) => media_path.to_string(),
            _ => "<unknown>".to_string(),
        };
        let path = self
            .save_path
            .as_ref()
            .map_or(original_media_file_path, |x| x.clone());
        Path::new(&path)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_string()
    }

    pub fn as_frontend_document(&self) -> FrontendDocument {
        FrontendDocument {
            id: self.id,
            display_name: self.display_name(),
            transcription_progress: self.transcription_progress,
            save_path: self.save_path.clone(),
            media_files: self.media_files.clone(),
            has_unsaved_changes: self.has_unsaved_changes,
        }
    }
}

#[derive(Serialize, Debug)]
pub struct FrontendDocument {
    id: Uuid,
    display_name: String,
    transcription_progress: f32,
    save_path: Option<String>,
    media_files: Vec<MediaFile>,
    has_unsaved_changes: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MediaFile {
    pub content_type: String,
    pub tags: Vec<String>,
    /// this must be in the format {document_id}/{something}
    pub url: String,
    pub source: MediaFileSource,
}
impl MediaFile {
    pub fn from_worker_adapter_media_file(
        v: worker_adapter::state::MediaFile,
        document_uuid: Uuid,
    ) -> Result<Self> {
        let mime = infer::get_from_path(&v.path)?
            .map(|x| x.mime_type())
            .unwrap_or("application/octet-stream");
        Ok(Self {
            content_type: mime.to_string(),
            tags: v.tags,
            url: format!("{document_uuid}/reencode"),
            source: MediaFileSource::Fs { media_path: v.path },
        })
    }
}

pub trait DocumentsStoreExt<R: Runtime> {
    fn get_documents(&self) -> Result<Vec<Document>>;
    fn get_document(&self, id: Uuid) -> Result<Document>;
    fn update_documents(&self, op: impl Fn(Vec<Document>) -> Result<Vec<Document>>) -> Result<()>;
    fn update_document(&self, id: Uuid, op: impl Fn(Document) -> Document) -> Result<()>;
    fn open_document(&self, path: &str) -> Result<Document>;
    fn create_new_document(&self, media_file_path: String) -> Result<Document>;
}
impl<R: Runtime, T: Manager<R> + Emitter<R>> DocumentsStoreExt<R> for T {
    fn get_documents(&self) -> Result<Vec<Document>> {
        let store = self
            .get_store("documents.json")
            .ok_or(anyhow!("documents.json store was not loaded"))?;
        if !store.has("documents") {
            store.set("documents", json!([]));
        }
        let documents_json = store
            .get("documents")
            .ok_or(anyhow!("documents.json does not contain documents key"))?;
        let documents: Vec<Document> = serde_json::from_value(documents_json)?;
        Ok(documents)
    }

    fn get_document(&self, id: Uuid) -> Result<Document> {
        let active_doc = self.get_documents()?.into_iter().find(|doc| doc.id == id);
        if let Some(active) = active_doc {
            Ok(active.clone())
        } else {
            bail!("no open document with id {id} found!")
        }
    }

    fn update_documents(&self, op: impl Fn(Vec<Document>) -> Result<Vec<Document>>) -> Result<()> {
        let documents = self.get_documents()?;
        let new_documents = op(documents)?;
        let documents_json = serde_json::to_value(new_documents.clone())?;
        self.get_store("documents.json")
            .ok_or(anyhow!("documents.json store was not loaded"))?
            .set("documents", documents_json);
        let frontend_documents: Vec<FrontendDocument> = new_documents
            .iter()
            .rev()
            .map(Document::as_frontend_document)
            .collect();
        self.emit("documents_changed", &frontend_documents).unwrap();
        Ok(())
    }

    fn update_document(&self, id: Uuid, op: impl Fn(Document) -> Document) -> Result<()> {
        self.update_documents(|mut documents| {
            for doc in &mut documents {
                if doc.id == id {
                    *doc = op(doc.clone());
                    self.emit(
                        &format!("document_changed:{id}"),
                        &doc.as_frontend_document(),
                    )
                    .unwrap();
                    break;
                }
            }
            Ok(documents)
        })?;
        Ok(())
    }

    fn open_document(&self, path: &str) -> Result<Document> {
        let already_opened = self
            .get_documents()?
            .into_iter()
            .find(|doc| doc.save_path.as_ref().map(|p| p == path).unwrap_or(false));
        if let Some(document) = already_opened {
            return Ok(document);
        }

        let automerge_doc = transcribee_archive::get_automerge_doc(path)?;
        let (id, app_data_path) = create_new_appdata_transcribee_archive(self, &automerge_doc)?;

        let media_source = MediaFileSource::InTar {
            archive_path: path.to_string(),
            path_in_archive: "media".to_string(),
        };
        let mime_guess_bytes = 24;
        let mime_guess_buf = media_source.get_bytes(0..mime_guess_bytes)?;
        let mime = infer::get(&mime_guess_buf)
            .map(|x| x.mime_type())
            .unwrap_or("application/octet-stream");
        let media_files = vec![MediaFile {
            content_type: mime.to_string(),
            tags: vec!["browser_compatible".to_string()],
            url: format!("{id}/media"),
            source: media_source,
        }];

        let document = Document {
            id,
            app_data_path: app_data_path.to_str().unwrap().to_string(),
            save_path: Some(path.to_string()),
            transcription_progress: 1.0,
            tasks: vec![],
            media_files,
            has_unsaved_changes: false,
        };
        self.update_documents(|mut documents| {
            documents.push(document.clone());
            Ok(documents)
        })?;
        Ok(document)
    }

    fn create_new_document(&self, media_file_path: String) -> Result<Document> {
        let (id, app_data_path) = create_new_appdata_transcribee_archive(self, &[])?;
        let mime = infer::get_from_path(&media_file_path)?
            .map(|x| x.mime_type())
            .unwrap_or("application/octet-stream");
        let media_files = vec![MediaFile {
            content_type: mime.to_string(),
            tags: vec!["original".to_string()],
            url: format!("{id}/original"),
            source: MediaFileSource::Fs {
                media_path: media_file_path.to_string(),
            },
        }];
        let document = Document {
            id,
            app_data_path: app_data_path.to_str().unwrap().to_string(),
            save_path: None,
            transcription_progress: 0.0,
            tasks: vec![],
            media_files,
            has_unsaved_changes: false,
        };
        self.update_documents(|mut documents| {
            documents.push(document.clone());
            Ok(documents)
        })?;
        Ok(document)
    }
}

#[command]
pub fn get_documents(app_handle: AppHandle) -> CmdResult<Vec<FrontendDocument>> {
    Ok(app_handle
        .get_documents()?
        .iter()
        .map(Document::as_frontend_document)
        .rev()
        .collect())
}

#[command]
pub fn get_document(app_handle: AppHandle, id: Uuid) -> CmdResult<FrontendDocument> {
    Ok(app_handle.get_document(id)?.as_frontend_document())
}

/// this deletes the document from the list of recent documents.
/// If a transcription job is currently running for this document, it gets canceled.
/// If the document has unsaved changes, these get deleted, so in this case the frontend
/// should display a confirmation dialog.
#[command]
pub fn forget_document(
    app_handle: AppHandle,
    worker_adapter: State<'_, WorkerAdapter>,
    id: Uuid,
) -> CmdResult<()> {
    app_handle.update_documents(|mut documents| {
        if let Some(position) = documents.iter().position(|doc| doc.id == id) {
            let doc = documents.remove(position);
            for task in doc.tasks {
                if let Err(e) = worker_adapter.tasks.blocking_lock().remove_task(task) {
                    warn!("could not remove task: {e}")
                }
            }
            remove_file(doc.app_data_path)?;
        }
        Ok(documents)
    })?;
    Ok(())
}

pub async fn get_document_media_for_save_or_display_error(
    app_handle: &AppHandle,
    document: &Document,
) -> Result<MediaFileSource> {
    let Some(media_file) = document
        .media_files
        .iter()
        .find(|m| m.tags.iter().any(|t| t == "browser_compatible"))
    else {
        let focused_window =
            focused_window(app_handle).ok_or(anyhow!("could not get focused window"))?;
        focused_window
            .dialog()
            .message("Could not save because no suitable media file was found. Please try again in a few seconds when transcribee has prepared a suitable file.")
            .kind(MessageDialogKind::Error)
            .title("could not save")
            .show(|_result| {});
        return Err(anyhow!(
            "could not save because no suitable media file was found!"
        ));
    };

    Ok(media_file.source.clone())
}

#[command]
pub async fn save_document(app_handle: AppHandle, id: Uuid) -> CmdResult<()> {
    let document = app_handle.get_document(id)?;
    let Some(save_path) = &document.save_path else {
        return save_document_as_dialog(app_handle.clone(), id).await;
    };
    let media_file = get_document_media_for_save_or_display_error(&app_handle, &document).await?;
    let new_automerge_doc = transcribee_archive::get_automerge_doc(&document.app_data_path)?;
    if !fs::exists(save_path)? {
        warn!("save target file under {save_path} does not exist, even if we think it should. Recreating file...");
        transcribee_archive::create_new(save_path, Some(media_file), &new_automerge_doc)?;
    } else {
        if let Err(e) = transcribee_archive::update_automerge_file(save_path, &new_automerge_doc) {
            warn!("transcribee_archive::update_automerge_file failed with error {e}, trying to re-creating the file...");
            transcribee_archive::create_new(save_path, Some(media_file), &new_automerge_doc)?;
        }
    }
    app_handle.update_document(id, |mut doc| {
        doc.has_unsaved_changes = false;
        doc
    })?;
    Ok(())
}

#[command]
pub async fn save_document_as_dialog(app_handle: AppHandle, id: Uuid) -> CmdResult<()> {
    let document = app_handle.get_document(id)?;
    let media_file = get_document_media_for_save_or_display_error(&app_handle, &document).await?;

    let focused_window =
        focused_window(&app_handle).ok_or(anyhow!("could not get focused window"))?;
    let (tx, rx) = oneshot::channel();
    let default_filename = document
        .display_name()
        .rsplit_once(".")
        .map(|(basename, _suffix)| basename.to_string())
        .unwrap_or(document.display_name());
    tauri::async_runtime::spawn(async move {
        focused_window
            .dialog()
            .file()
            .add_filter("Transcribee Archive", &["transcribee"])
            .set_file_name(default_filename)
            .save_file(|f| {
                tx.send(f).unwrap();
            });
    });
    let Some(save_path) = rx.await? else {
        return Ok(());
    };

    let automerge_doc = transcribee_archive::get_automerge_doc(&document.app_data_path)?;
    transcribee_archive::create_new(&save_path.to_string(), Some(media_file), &automerge_doc)?;

    app_handle.update_document(id, |mut doc| {
        doc.save_path = Some(save_path.to_string());
        doc.has_unsaved_changes = false;
        doc
    })?;
    Ok(())
}

#[command]
pub fn read_automerge(app_handle: AppHandle, id: Uuid) -> CmdResult<Response> {
    Ok(tauri::ipc::Response::new(
        transcribee_archive::get_automerge_doc(&app_handle.get_document(id)?.app_data_path)?,
    ))
}

#[command]
pub fn append_automerge_change(
    app_handle: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> CmdResult<()> {
    let tauri::ipc::InvokeBody::Raw(change) = request.body() else {
        return Err(anyhow!("request body to append_automerge_change must be raw").into());
    };
    let Some(id) = request.headers().get("id") else {
        return Err(anyhow!("missing id for append_automerge_change").into());
    };
    let uuid = Uuid::from_str(id.to_str()?)?;
    let document = app_handle.get_document(uuid)?;
    transcribee_archive::append_automerge_change(&document.app_data_path, change)?;
    app_handle.update_document(uuid, |mut doc| {
        doc.has_unsaved_changes = true;
        doc
    })?;
    Ok(())
}

pub fn get_media_file_response(
    app_handle: &AppHandle,
    request: http::Request<Vec<u8>>,
) -> Result<http::Response<Vec<u8>>> {
    let path = percent_encoding::percent_decode(request.uri().path().as_bytes())
        .decode_utf8_lossy()
        .to_string();
    let path = path.trim_start_matches("/");

    let (document_id, suffix) = &path
        .split_once("/")
        .ok_or(anyhow!("invalid path (needs to contain at least one /)"))?;
    let uuid = Uuid::from_str(document_id)?;

    let document = app_handle.get_document(uuid)?;
    let media = document
        .media_files
        .into_iter()
        .find(|m| m.url == path)
        .ok_or(anyhow!(
            "media file {suffix} not found in document {document_id}"
        ))?;

    http_response_maybe_partial(
        request.headers().get("range"),
        |range| media.source.get_bytes(range),
        media.source.len()?,
        &media.content_type,
    )
}

fn create_new_appdata_transcribee_archive<R: Runtime, T: Manager<R> + Emitter<R>>(
    app_handle: &T,
    automerge_doc: &[u8],
) -> Result<(Uuid, PathBuf)> {
    let id = Uuid::now_v7();
    let filename = format!("documents/{}.transcribee", id);
    let path = app_handle
        .path()
        .resolve(filename, BaseDirectory::AppData)?;
    if let Some(parent) = path.parent() {
        if !fs::exists(parent)? {
            fs::create_dir_all(parent)?;
        }
    }
    transcribee_archive::create_new(path.to_str().unwrap(), None, automerge_doc)?;
    Ok((id, path))
}
