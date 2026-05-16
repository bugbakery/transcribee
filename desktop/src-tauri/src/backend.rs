use std::future::IntoFuture;
use std::net::SocketAddr;

use axum::{routing::get, Router};

pub struct Backend {
    listener: Option<std::net::TcpListener>,
    token: Option<String>,
}

impl Backend {
    pub fn new() -> Self {
        return Backend {
            listener: None,
            token: None,
        };
    }
    pub fn bind(&mut self) -> std::io::Result<SocketAddr> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let addr = listener.local_addr();
        self.listener = Some(listener);
        addr
    }
    pub fn with_token(mut self, token: String) -> Self {
        self.token = Some(token);
        self
    }

    pub async fn serve(self) -> std::io::Result<()> {
        let service = self.get_router();
        let listener = tokio::net::TcpListener::from_std(self.listener.unwrap())?;
        axum::serve(listener, service).await
    }

    fn get_router(&self) -> Router {
        let app = Router::new().route("/", get(|| async { "Hello, World!" }));
        return app;
    }
}
