use std::str::FromStr;

use crate::{file_handling::DocumentsStoreExt, http_partial_content::http_response_maybe_partial};
use anyhow::{anyhow, Result};
use http::{
    header::{ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_TYPE},
    response::Builder as ResponseBuilder,
    StatusCode,
};
use tauri::{AppHandle, Builder, Wry};
use uuid::Uuid;

pub fn install_media_file_serve(builder: Builder<Wry>) -> Builder<Wry> {
    builder.register_asynchronous_uri_scheme_protocol("media", move |ctx, request, responder| {
        match get_media_file_response(ctx.app_handle(), request) {
            Ok(http_response) => responder.respond(http_response),
            Err(e) => responder.respond(
                ResponseBuilder::new()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header(CONTENT_TYPE, "text/plain")
                    .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(e.to_string().as_bytes().to_vec())
                    .unwrap(),
            ),
        }
    })
}

fn get_media_file_response(
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
