use desktop_backend::Backend;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();
    let token = "SECRET_TOKEN".to_string(); // TODO: generate random token
    let mut backend = Backend::new().with_token(token.clone());
    let local_addr = backend.bind().unwrap();
    log::info!("starting backend on http://{:?}", local_addr);
    backend.serve().await
}
