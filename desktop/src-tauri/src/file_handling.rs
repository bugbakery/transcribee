use anyhow::{anyhow, Context, Result};
use http::header::{ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE};
use http::response::Builder as ResponseBuilder;
use http::StatusCode;
use http_range::HttpRange;
use log::{info, warn};
use std::fs::File;
use std::io::SeekFrom::Start;
use std::io::{Read, Seek, Write};
use tauri::{command, ipc::Response};

use crate::tar::{get_byte_range_of_file_in_tar, TarHeader, TAR_BLOCK_SIZE};
#[command]
pub async fn read_automerge(path: String) -> std::result::Result<Response, String> {
    read_automerge_internal(path)
        .await
        .map_err(|e| e.to_string())
        .map(tauri::ipc::Response::new)
}

async fn read_automerge_internal(path: String) -> Result<Vec<u8>> {
    let mut file = File::open(&path).with_context(|| format!("could not open file '{}'", path))?;
    let data_range = get_byte_range_of_file_in_tar(&mut file, "document.automerge")?;
    file.seek(Start(data_range.start))?;
    let mut buf = vec![0u8; (data_range.end - data_range.start) as usize];
    file.read_exact(&mut buf)?;
    Ok(buf)
}

#[command]
pub async fn append_automerge_change(
    request: tauri::ipc::Request<'_>,
) -> std::result::Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(change) = request.body() else {
        return Err("request body to append_automerge_change must be raw".to_string());
    };
    let Some(path) = request.headers().get("path") else {
        return Err("missing path for append_automerge_change".to_string());
    };

    append_automerge_change_internal(path.to_str().unwrap(), change)
        .await
        .map_err(|e| e.to_string())
}

async fn append_automerge_change_internal(path: &str, change: &[u8]) -> Result<()> {
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
