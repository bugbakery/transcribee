/// documents in transcribee desktop go through different phases:
/// they are created as _new_ documents that live in our appdata folder. when they are in this phase
/// they do not contain an embedded media file but we store the media separately. For _new_ files we
/// store the media path and the displayname separately in our state.
/// When the user first saves the file, we show them a file picker so that they can select where
/// to store the file. They then become _mature_ files that have the media embedded.
/// For _mature_ documents, the media file is embedded and we derive the display name from the
/// file name.
use crate::tar::{
    get_byte_range_of_file_in_tar, get_bytes_of_file_in_tar, TarHeader, TAR_BLOCK_SIZE,
};
use anyhow::{anyhow, Context, Result};
use http::header::{ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE};
use http::response::Builder as ResponseBuilder;
use http::StatusCode;
use http_range::HttpRange;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::fs::{self, remove_file, File};
use std::io::SeekFrom::Start;
use std::io::{Read, Seek, Write};
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::{command, ipc::Response};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;
use worker_adapter::state::TranscribeTaskParameters;
use worker_adapter::WorkerAdapter;

#[derive(Serialize, Deserialize, Clone)]
pub struct Document {
    /// this is the working copy of the document where we put all changes as they occur.
    /// this ID is also used as the main identifyer to of the document
    pub app_data_path: String,

    /// this is the path under which the user explicitly saved their document. We only write this
    /// when explicitly instructed to do so.
    save_path: Option<String>,

    /// the path of the original media file that was used to create the document.
    /// if the document came here already as a mature document, this is None.
    original_media_file: Option<String>,
    transcription_progress: f32,
}

fn get_documents_store(app_handle: &AppHandle) -> Result<Vec<Document>> {
    let documents_json = app_handle
        .get_store("documents.json")
        .ok_or(anyhow!("documents.json store was not loaded"))?
        .get("documents")
        .ok_or(anyhow!("documents.json does not contain document key"))?;
    let documents: Vec<Document> = serde_json::from_value(documents_json)?;
    Ok(documents)
}

fn update_document_store(
    app_handle: &AppHandle,
    op: impl Fn(Vec<Document>) -> Result<Vec<Document>>,
) -> Result<()> {
    let documents = get_documents_store(app_handle)?;
    let new_documents = op(documents)?;
    let documents_json = serde_json::to_value(new_documents)?;
    app_handle
        .get_store("documents.json")
        .ok_or(anyhow!("documents.json store was not loaded"))?
        .set("documents", documents_json);
    Ok(())
}

fn get_document(app_handle: &AppHandle, path: &str) -> Result<Document> {
    let active_doc = get_documents_store(app_handle)?.into_iter().find(|doc| {
        doc.app_data_path == path || doc.save_path.as_ref().map(|p| p == path).unwrap_or(false)
    });
    if let Some(active) = active_doc {
        Ok(active.clone())
    } else {
        // we open a new mature document and import it into our document list
        let automerge_doc = get_bytes_of_file_in_tar(&mut File::open(path)?, "document.automerge")?;
        let app_data_path = create_new_appdata_transcribee_archive(app_handle, &automerge_doc)?;
        let document = Document {
            app_data_path: app_data_path.to_str().unwrap().to_string(),
            save_path: Some(path.to_string()),
            original_media_file: None,
            transcription_progress: 1.0,
        };
        update_document_store(app_handle, |mut documents| {
            documents.push(document.clone());
            Ok(documents)
        })?;
        Ok(document)
    }
}

fn create_new_appdata_transcribee_archive(
    app_handle: &AppHandle,
    automerge_doc: &[u8],
) -> Result<PathBuf> {
    let filename = format!("new_files/{}.transcribee", Uuid::now_v7());
    let path = app_handle
        .path()
        .resolve(filename, BaseDirectory::AppData)?;
    if !fs::exists(path.parent().unwrap())? {
        fs::create_dir_all(&path)?;
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
    Ok(path)
}

pub fn create_new_document(app_handle: &AppHandle, media_file_path: String) -> Result<Document> {
    let app_data_path = create_new_appdata_transcribee_archive(app_handle, &[])?;
    Ok(Document {
        app_data_path: app_data_path.to_str().unwrap().to_string(),
        save_path: None,
        original_media_file: Some(media_file_path),
        transcription_progress: 0.0,
    })
}

#[command]
pub fn list_documents(app_handle: AppHandle) -> std::result::Result<Vec<Document>, String> {
    Ok(get_documents_store(&app_handle)
        .map_err(|e| e.to_string())?
        .into_iter()
        .rev()
        .collect())
}

#[command]
pub fn document_info(app_handle: AppHandle, path: String) -> std::result::Result<Document, String> {
    get_document(&app_handle, &path).map_err(|e| e.to_string())
}

/// this deletes the document from the list of recent documents.
/// If a transcription job is currently running for this document, it gets canceled.
/// If the document has unsaved changes, these get deleted, so in this case the frontend
/// should display a confirmation dialog.
/// TODO: build cancelation logic
#[command]
pub fn forget_document(
    app_handle: AppHandle,
    document_app_data_path: String,
) -> std::result::Result<(), String> {
    update_document_store(&app_handle, |mut documents| {
        if let Some(position) = documents
            .iter()
            .position(|doc| doc.app_data_path == document_app_data_path)
        {
            let doc = documents.remove(position);
            remove_file(doc.app_data_path)?;
        }
        Ok(documents)
    })
    .map_err(|e| e.to_string())
}

#[command]
pub async fn transcribe_file(
    app_handle: AppHandle,
    worker_adapter: State<'_, WorkerAdapter>,
    media_file_path: String,
) -> Result<String, String> {
    let document =
        create_new_document(&app_handle, media_file_path.clone()).map_err(|e| e.to_string())?;
    let job_uuid = worker_adapter
        .start_transcription(
            media_file_path,
            TranscribeTaskParameters {
                lang: "auto".to_string(),
                model: "tiny".to_string(),
            },
        )
        .await;

    let app_data_path = document.app_data_path.clone();
    worker_adapter
        .add_change_listener(move |uuid, change| {
            if uuid == job_uuid {
                append_automerge_change_to_transcribee_file(&app_data_path, change).unwrap()
            }
        })
        .await;

    Ok(document.app_data_path)
}

#[command]
pub fn read_automerge(path: String) -> std::result::Result<Response, String> {
    read_automerge_internal(path)
        .map_err(|e| e.to_string())
        .map(tauri::ipc::Response::new)
}

fn read_automerge_internal(path: String) -> Result<Vec<u8>> {
    let mut file = File::open(&path).with_context(|| format!("could not open file '{}'", path))?;
    get_bytes_of_file_in_tar(&mut file, "document.automerge")
}

#[command]
pub fn append_automerge_change(
    app_handle: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> std::result::Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(change) = request.body() else {
        return Err("request body to append_automerge_change must be raw".to_string());
    };
    let Some(path) = request.headers().get("path") else {
        return Err("missing path for append_automerge_change".to_string());
    };
    let document = get_document(&app_handle, path.to_str().unwrap()).map_err(|e| e.to_string())?;
    append_automerge_change_to_transcribee_file(&document.app_data_path, change)
        .map_err(|e| e.to_string())
}

fn append_automerge_change_to_transcribee_file(path: &str, change: &[u8]) -> Result<()> {
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

// this is stolen and adapted from
// https://github.com/tauri-apps/tauri/blob/3f62c70d6b9a9eeeb7c302b010c858405a1bb761/examples/streaming/main.rs#L15
pub fn get_file_from_archive_as_response(
    request: http::Request<Vec<u8>>,
) -> Result<http::Response<Vec<u8>>> {
    let path = percent_encoding::percent_decode(request.uri().path().as_bytes())
        .decode_utf8_lossy()
        .to_string();

    let (archive_path, filename) = path
        .rsplit_once("/")
        .ok_or(anyhow!("invalid path (needs to contain at least one /)"))?;
    let mut file = File::open(archive_path)
        .with_context(|| format!("could not open archive file '{}'", path))?;
    let data_range = get_byte_range_of_file_in_tar(&mut file, filename)?;
    let len = data_range.end - data_range.start;

    let mime_guess_bytes = 24;
    let mut buf = vec![0u8; mime_guess_bytes];
    file.seek(Start(data_range.start))?;
    file.read_exact(&mut buf)?;
    let mime = infer::get(&buf)
        .map(|x| x.mime_type())
        .unwrap_or("application/octet-stream");

    let mut resp = ResponseBuilder::new()
        .header(CONTENT_TYPE, mime)
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*");

    // if the webview sent a range header, we need to send a 206 in return
    let http_response = if let Some(range_header) = request.headers().get("range") {
        let not_satisfiable = || {
            ResponseBuilder::new()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(CONTENT_RANGE, format!("bytes */{len}"))
                .body(vec![])
        };

        // parse range header
        let ranges = if let Ok(ranges) = HttpRange::parse(range_header.to_str()?, len) {
            ranges
                .iter()
                // map the output back to spec range <start-end>, example: 0-499
                .map(|r| (r.start, r.start + r.length - 1))
                .collect::<Vec<_>>()
        } else {
            return Ok(not_satisfiable()?);
        };

        /// The Maximum bytes we send in one range
        const MAX_LEN: u64 = 1000 * 1024;

        if ranges.len() == 1 {
            let &(start, mut end) = ranges.first().unwrap();

            // check if a range is not satisfiable
            //
            // this should be already taken care of by HttpRange::parse
            // but checking here again for extra assurance
            if start >= len || end >= len || end < start {
                return Ok(not_satisfiable()?);
            }

            // adjust end byte for MAX_LEN
            end = start + (end - start).min(len - start).min(MAX_LEN - 1);

            let bytes_to_read = end + 1 - start;
            let mut buf = vec![0u8; bytes_to_read as usize];
            file.seek(Start(data_range.start + start))?;
            file.read_exact(&mut buf)?;

            resp = resp.header(CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
            resp = resp.header(CONTENT_LENGTH, end + 1 - start);
            resp = resp.status(StatusCode::PARTIAL_CONTENT);
            resp.body(buf)
        } else {
            let mut buf = Vec::new();
            let ranges = ranges
                .iter()
                .filter_map(|&(start, mut end)| {
                    // filter out unsatisfiable ranges
                    //
                    // this should be already taken care of by HttpRange::parse
                    // but checking here again for extra assurance
                    if start >= len || end >= len || end < start {
                        None
                    } else {
                        // adjust end byte for MAX_LEN
                        end = start + (end - start).min(len - start).min(MAX_LEN - 1);
                        Some((start, end))
                    }
                })
                .collect::<Vec<_>>();

            let boundary = random_boundary();
            let boundary_sep = format!("\r\n--{boundary}\r\n");
            let boundary_closer = format!("\r\n--{boundary}\r\n");

            resp = resp.header(
                CONTENT_TYPE,
                format!("multipart/byteranges; boundary={boundary}"),
            );

            for (start, end) in ranges {
                // a new range is being written, write the range boundary
                buf.write_all(boundary_sep.as_bytes())?;

                // write the needed headers `Content-Type` and `Content-Range`
                buf.write_all(format!("{CONTENT_TYPE}: {mime}\r\n").as_bytes())?;
                buf.write_all(
                    format!("{CONTENT_RANGE}: bytes {start}-{end}/{len}\r\n").as_bytes(),
                )?;

                // write the separator to indicate the start of the range body
                buf.write_all("\r\n".as_bytes())?;

                let bytes_to_read = end + 1 - start;
                let mut local_buf = vec![0u8; bytes_to_read as usize];
                file.seek(Start(data_range.start + start))?;
                file.read_exact(&mut local_buf)?;
                buf.extend_from_slice(&local_buf);
            }
            // all ranges have been written, write the closing boundary
            buf.write_all(boundary_closer.as_bytes())?;

            resp.body(buf)
        }
    } else {
        resp = resp.header(CONTENT_LENGTH, len);
        let mut buf = vec![0u8; len as usize];
        file.seek(Start(data_range.start))?;
        file.read_exact(&mut buf)?;
        resp.body(buf)
    };

    http_response.map_err(Into::into)
}
fn random_boundary() -> String {
    let mut x = [0_u8; 30];
    getrandom::fill(&mut x).expect("failed to get random bytes");
    (x[..])
        .iter()
        .map(|&x| format!("{x:x}"))
        .fold(String::new(), |mut a, x| {
            a.push_str(x.as_str());
            a
        })
}

#[cfg(test)]
pub mod test {
    use super::*;
    use http::{header::RANGE, Request};

    #[test]
    fn test_get_archive_response_whole() {
        let uri = format!(
            "archive://localhost/{}/../test-data/sample.transcribee/media",
            std::env::current_dir()
                .unwrap()
                .as_os_str()
                .to_str()
                .unwrap()
        );
        let response = get_file_from_archive_as_response(
            Request::builder().uri(uri).body(vec![0u8; 0]).unwrap(),
        )
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().len(), 196938);
        assert_eq!(response.headers().get(CONTENT_LENGTH).unwrap(), "196938");
        assert_eq!(
            response.headers().get(ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(),
            "*"
        );
    }

    #[test]
    fn test_get_archive_response_single_range() {
        let uri = format!(
            "archive://localhost/{}/../test-data/sample.transcribee/media",
            std::env::current_dir()
                .unwrap()
                .as_os_str()
                .to_str()
                .unwrap()
        );
        let full_response: http::Response<Vec<u8>> = get_file_from_archive_as_response(
            Request::builder().uri(&uri).body(vec![0u8; 0]).unwrap(),
        )
        .unwrap();
        let full_body = full_response.body();

        let range_response: http::Response<Vec<u8>> = get_file_from_archive_as_response(
            Request::builder()
                .uri(&uri)
                .header(RANGE, "bytes=42-1337")
                .body(vec![0u8; 0])
                .unwrap(),
        )
        .unwrap();
        assert_eq!(range_response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            range_response.headers().get(CONTENT_LENGTH).unwrap(),
            &format!("{}", 1338 - 42)
        );
        assert_eq!(
            range_response
                .headers()
                .get(ACCESS_CONTROL_ALLOW_ORIGIN)
                .unwrap(),
            "*"
        );
        assert_eq!(range_response.body(), &full_body[42..1338])
    }
}
