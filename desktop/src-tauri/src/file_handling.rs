//! documents in transcribee desktop go through different phases:
//! they are created as _new_ documents that live in our appdata folder. when they are in this phase
//! they do not contain an embedded media file but we store the media separately. For _new_ files we
//! store the media path and the displayname separately in our state.
//! When the user first saves the file, we show them a file picker so that they can select where
//! to store the file. They then become _mature_ files that have the media embedded.
//! For _mature_ documents, the media file is embedded and we derive the display name from the
//! file name.

use crate::cmd_error::CmdResult;
use crate::file_handling::MediaFileSource::InTar;
use crate::http_partial_content::http_response_maybe_partial;
use crate::tar::{
    get_byte_range_of_file_in_tar, get_bytes_of_file_in_tar, get_next_tar_entry, TarHeader,
    TAR_BLOCK_SIZE,
};
use anyhow::{anyhow, bail, Context, Result};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs::{self, remove_file, File};
use std::io::SeekFrom::Start;
use std::io::{Read, Seek, Write};
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use tauri::path::BaseDirectory;
use tauri::{command, ipc::Response};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: Uuid,

    /// this is the working copy of the document where we put all changes as they occur.
    /// this ID is also used as the main identifyer to of the document
    pub app_data_path: String,

    /// this is the path under which the user explicitly saved their document. We only write this
    /// when explicitly instructed to do so.
    pub save_path: Option<String>,

    /// the path of the original media file that was used to create the document.
    /// if the document came here already as a mature document, this is None.
    pub original_media_file: Option<String>,

    pub tasks: Vec<Uuid>,
    pub transcription_progress: f32,
}
impl Document {
    pub fn display_name(&self) -> String {
        let original_media_file = self
            .original_media_file
            .as_ref()
            .map_or("unknown_file".to_string(), |x| x.clone());
        let path = self
            .save_path
            .as_ref()
            .map_or(original_media_file, |x| x.clone());
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
        }
    }

    pub fn media_files(&self) -> Result<Vec<MediaFile>> {
        let mut to_return = vec![];

        if let Some(original) = &self.original_media_file {
            let mime = infer::get_from_path(original)?
                .map(|x| x.mime_type())
                .unwrap_or("application/octet-stream");
            to_return.push(MediaFile {
                content_type: mime.to_string(),
                tags: vec!["original".to_string()],
                url: format!("{}/original", self.id),
                source: MediaFileSource::Fs(original.to_string()),
            })
        }

        if let Some(saved_archive) = &self.save_path {
            let mut file = File::open(saved_archive)?;
            let mut offset = 0;
            while let Some((header, file_start)) = get_next_tar_entry(&mut file, offset)? {
                if header.path != "document.automerge" {
                    let mime_guess_bytes = 24;
                    let mut buf = vec![0u8; mime_guess_bytes];
                    file.read_exact(&mut buf)?;
                    let mime = infer::get(&buf)
                        .map(|x| x.mime_type())
                        .unwrap_or("application/octet-stream");
                    to_return.push(MediaFile {
                        content_type: mime.to_string(),
                        tags: vec![],
                        url: format!("{}/{}", self.id, header.path),
                        source: InTar(saved_archive.to_string(), header.path),
                    });
                }
                offset = file_start + header.size;
            }
        }

        Ok(to_return)
    }
}

#[derive(Serialize, Debug)]
pub struct FrontendDocument {
    id: Uuid,
    display_name: String,
    transcription_progress: f32,
}

#[derive(Serialize, Debug)]
pub struct MediaFile {
    content_type: String,
    tags: Vec<String>,
    /// this must be in the format {document_id}/{something}
    url: String,
    #[serde(skip)]
    source: MediaFileSource,
}
#[derive(Debug)]
enum MediaFileSource {
    Fs(String),
    InTar(String, String),
}

pub trait DocumentsStoreExt<R: Runtime> {
    fn get_documents(&self) -> Result<Vec<Document>>;
    fn get_document(&self, id: Uuid) -> Result<Document>;
    fn update_documents(&self, op: impl Fn(Vec<Document>) -> Result<Vec<Document>>) -> Result<()>;
    fn update_document(&self, id: Uuid, op: impl Fn(Document) -> Document) -> Result<()>;
    fn open_document(&self, path: &str) -> Result<Document>;
    fn get_document_from_task(&self, task: Uuid) -> Result<Document>;
    fn create_new_document(&self, media_file_path: String, tasks: Vec<Uuid>) -> Result<Document>;
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
                    self.emit(&format!("document_changed:{id}"), &doc).unwrap();
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

        let automerge_doc = get_bytes_of_file_in_tar(&mut File::open(path)?, "document.automerge")?;
        let (id, app_data_path) = create_new_appdata_transcribee_archive(self, &automerge_doc)?;
        let document = Document {
            id,
            app_data_path: app_data_path.to_str().unwrap().to_string(),
            save_path: Some(path.to_string()),
            original_media_file: None,
            transcription_progress: 1.0,
            tasks: vec![],
        };
        self.update_documents(|mut documents| {
            documents.push(document.clone());
            Ok(documents)
        })?;
        Ok(document)
    }

    fn get_document_from_task(&self, task: Uuid) -> Result<Document> {
        self.get_documents()?
            .into_iter()
            .find(|doc| doc.tasks.iter().any(|t| t == &task))
            .ok_or(anyhow!("could not find document for task {task}"))
    }

    fn create_new_document(&self, media_file_path: String, tasks: Vec<Uuid>) -> Result<Document> {
        let (id, app_data_path) = create_new_appdata_transcribee_archive(self, &[])?;
        let document = Document {
            id,
            app_data_path: app_data_path.to_str().unwrap().to_string(),
            save_path: None,
            original_media_file: Some(media_file_path),
            transcription_progress: 0.0,
            tasks,
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
/// TODO: build cancelation logic
#[command]
pub fn forget_document(app_handle: AppHandle, id: Uuid) -> CmdResult<()> {
    app_handle.update_documents(|mut documents| {
        if let Some(position) = documents.iter().position(|doc| doc.id == id) {
            let doc = documents.remove(position);
            remove_file(doc.app_data_path)?;
        }
        Ok(documents)
    })?;
    Ok(())
}

#[command]
pub fn read_automerge(app_handle: AppHandle, id: Uuid) -> CmdResult<Response> {
    let path = app_handle.get_document(id)?.app_data_path;
    let mut file = File::open(&path).with_context(|| format!("could not open file '{}'", path))?;
    Ok(tauri::ipc::Response::new(get_bytes_of_file_in_tar(
        &mut file,
        "document.automerge",
    )?))
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
    append_automerge_change_to_transcribee_file(&document.app_data_path, change)?;
    Ok(())
}

#[command]
pub fn document_media(app_handle: AppHandle, id: Uuid) -> CmdResult<Vec<MediaFile>> {
    let document = app_handle.get_document(id)?;
    Ok(document.media_files()?)
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
        .media_files()?
        .into_iter()
        .find(|m| m.url == path)
        .ok_or(anyhow!(
            "media file {suffix} not found in document {document_id}"
        ))?;

    match &media.source {
        MediaFileSource::Fs(path) => {
            let mut file = File::open(path)
                .with_context(|| format!("could not open media file '{}'", path))?;
            let len = file.metadata()?.len();
            let get_content = move |range: Range<u64>| {
                file.seek(Start(range.start))?;
                let mut buf = vec![0u8; (range.end - range.start) as usize];
                file.read_exact(&mut buf)?;
                Ok(buf)
            };
            http_response_maybe_partial(
                request.headers().get("range"),
                get_content,
                len,
                &media.content_type,
            )
        }
        MediaFileSource::InTar(tar_path, path_in_tar) => {
            let mut file = File::open(tar_path)
                .with_context(|| format!("could not open archive file '{}'", path))?;
            let file_range = get_byte_range_of_file_in_tar(&mut file, path_in_tar)?;
            let len = file_range.end - file_range.start;
            let get_content = move |range: Range<u64>| {
                file.seek(Start(range.start))?;
                let mut buf = vec![0u8; (range.end - range.start) as usize];
                file.read_exact(&mut buf)?;
                Ok(buf)
            };
            http_response_maybe_partial(
                request.headers().get("range"),
                get_content,
                len,
                &media.content_type,
            )
        }
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
    let mut file = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(&path)
        .with_context(|| format!("could not open file '{}'", path.display()))?;

    file.write_all(
        &TarHeader {
            path: "document.automerge".to_string(),
            size: automerge_doc.len() as u64,
        }
        .as_bytes()?,
    )?;
    file.write_all(automerge_doc)?;
    Ok((id, path))
}

pub fn append_automerge_change_to_transcribee_file(path: &str, change: &[u8]) -> Result<()> {
    info!("got change with len={}", change.len());
    let mut file = File::options()
        .read(true)
        .write(true)
        .open(path)
        .with_context(|| format!("could not open file '{}'", path))?;
    let file_len = file.metadata()?.len();
    let data_range = get_byte_range_of_file_in_tar(&mut file, "document.automerge")?;
    if data_range.end != file_len {
        // this is only a warning because if transcribee crashes between writing the file and updating the tar header
        // (see below), we can get a tar file where document.automerge is not right at the end
        warn!(
            "document.automerge is not at the end of the archive. (document.automerge end: {}; file length: {})",
            data_range.end, file_len
        );
    }
    // first, append the data to the end of the document. This does not yet
    // change the data that transcribee woulde see when opening the file next time
    file.seek(Start(data_range.end))?;
    file.write_all(change)?;

    // patch the tar header for document.automerge. This is kinda the commit step
    file.seek(Start(data_range.start - TAR_BLOCK_SIZE))?;
    file.write_all(
        &TarHeader {
            path: "document.automerge".to_string(),
            size: data_range.end + change.len() as u64 - data_range.start,
        }
        .as_bytes()?,
    )?;

    Ok(())
}
