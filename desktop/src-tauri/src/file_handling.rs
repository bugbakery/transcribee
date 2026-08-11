//! documents in transcribee desktop go through different phases:
//! they are created as _new_ documents that live in our appdata folder. when they are in this phase
//! they do not contain an embedded media file but we store the media separately. For _new_ files we
//! store the media path and the displayname separately in our state.
//! When the user first saves the file, we show them a file picker so that they can select where
//! to store the file. They then become _mature_ files that have the media embedded.
//! For _mature_ documents, the media file is embedded and we derive the display name from the
//! file name.

use crate::transcribee_archive::{self, MediaFileSource};
use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs::{self};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Emitter, Manager, Runtime};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;
use worker_adapter::state::Task;
use worker_adapter::state::TaskState::{Aborted, Assigned, New};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("file-handling")
        .setup(|app, _| {
            app.store_builder("documents.json")
                .auto_save(Duration::from_secs(1))
                .build()?;

            // mark all jobs that are unfinished as aborted
            app.update_documents(move |mut documents| {
                for doc in &mut documents {
                    for task in &mut doc.worker_tasks {
                        if task.state == New || task.state == Assigned {
                            task.current_attempt = None;
                            task.state = Aborted;
                        }
                    }
                }
                Ok(documents)
            })?;
            Ok(())
        })
        .build()
}

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
    pub worker_tasks: Vec<Task>,

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
            save_path: self.save_path.clone(),
            media_files: self.media_files.clone(),
            has_unsaved_changes: self.has_unsaved_changes,
            tasks: self.worker_tasks.clone(),
        }
    }
}

#[derive(Serialize, Debug)]
pub struct FrontendDocument {
    id: Uuid,
    display_name: String,
    save_path: Option<String>,
    media_files: Vec<MediaFile>,
    has_unsaved_changes: bool,
    tasks: Vec<Task>,
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
            worker_tasks: vec![],
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
            worker_tasks: vec![],
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
