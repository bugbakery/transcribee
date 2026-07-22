use axum::extract::{Request, State};
use axum::http::{StatusCode, header};
use axum::middleware;
use axum::middleware::Next;
use axum::response::Response;
use axum::routing::post;
use axum::{Router, routing::get};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};

use crate::handlers::{claim_unassigned_task, dump_state, noop};
#[derive(Clone, Debug)]
struct ApiConfig {
    token: String,
}

async fn worker_auth(
    State(state): State<ApiConfig>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|header| header.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if auth_header == format!("Worker {}", state.token) {
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

pub struct BackendBuilder {
    port: Option<u16>,
    listener: Option<std::net::TcpListener>,
    token: Option<String>,
}

impl BackendBuilder {
    pub fn new() -> Self {
        return BackendBuilder {
            port: None,
            listener: None,
            token: None,
        };
    }
    pub fn with_token(mut self, token: String) -> Self {
        self.token = Some(token.clone());
        self
    }
    pub fn with_port(mut self, port: u16) -> Self {
        self.port = Some(port);
        self
    }
    pub fn bind(&mut self) -> std::io::Result<SocketAddr> {
        let listener = std::net::TcpListener::bind(SocketAddrV4::new(
            Ipv4Addr::new(127, 0, 0, 1),
            self.port.unwrap_or(0),
        ))?;
        listener.set_nonblocking(true)?;
        let addr = listener.local_addr();
        self.listener = Some(listener);
        addr
    }

    pub async fn serve(self) -> std::io::Result<()> {
        let service = self.get_router();
        let listener = tokio::net::TcpListener::from_std(self.listener.unwrap())?;
        axum::serve(listener, service).await
    }

    fn get_router(&self) -> Router {
        let state = ApiConfig {
            token: self.token.clone().unwrap(),
        };
        let app = Router::new()
            .route("/", get(dump_state))
            .route(
                "/api/v1/tasks/claim_unassigned_task/",
                post(claim_unassigned_task),
            )
            .route("/api/v1/tasks/{task_id}/keepalive/", post(noop))
            .route("/api/v1/tasks/{task_id}/mark_completed/", post(noop))
            .route("/api/v1/tasks/{task_id}/mark_failed/", post(noop))
            .route("/api/v1/documents/{document_id}/set_duration/", post(noop))
            .route(
                "/api/v1/documents/{document_id}/add_media_file/",
                post(noop),
            )
            .route_layer(middleware::from_fn_with_state(state.clone(), worker_auth))
            .with_state(state);

        return app;
    }
}
