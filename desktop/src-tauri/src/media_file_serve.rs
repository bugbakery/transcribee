use crate::{file_handling::DocumentsStoreExt, http_partial_content::http_response_maybe_partial};
use anyhow::{anyhow, Result};
use axum::{
    body::Body,
    extract::{Request, State},
    response::Response,
    routing::get,
    Router,
};
use http::{
    header::{ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_TYPE},
    response::Builder as ResponseBuilder,
    StatusCode,
};
use log::info;
use std::{
    net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener},
    str::FromStr,
};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Wry,
};
use uuid::Uuid;

pub struct MediaFileBase(pub String);

pub fn init() -> TauriPlugin<Wry> {
    // due to an upstream bug in webgkitgtk (https://bugs.webkit.org/show_bug.cgi?id=146351)
    // loading media from custom protocols does not work. Thus, just spawn an ordinary http server.
    Builder::new("media-file-serve")
        .setup(move |app, _| {
            let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 0))?;
            listener.set_nonblocking(true)?;

            app.manage(MediaFileBase(format!(
                "http://{}",
                listener.local_addr().unwrap()
            )));

            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                info!(
                    "starting media server on http://{}",
                    listener.local_addr().unwrap()
                );

                #[axum::debug_handler]
                async fn get_response(State(app): State<AppHandle>, request: Request) -> Response {
                    match get_media_file_response(&app, request) {
                        Ok(http_response) => http_response.map(Body::from),
                        Err(e) => ResponseBuilder::new()
                            .status(StatusCode::INTERNAL_SERVER_ERROR)
                            .header(CONTENT_TYPE, "text/plain")
                            .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                            .body(Body::from(e.to_string()))
                            .unwrap(),
                    }
                }

                let router = Router::new()
                    .route("/{*path}", get(get_response))
                    .with_state(app);
                axum::serve(
                    tokio::net::TcpListener::from_std(listener)?,
                    router.into_make_service_with_connect_info::<SocketAddr>(),
                )
                .await
            });
            Ok(())
        })
        .build()
}

fn get_media_file_response<R>(
    app_handle: &AppHandle,
    request: http::Request<R>,
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
