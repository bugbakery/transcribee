use clap::arg;
use clap::command;
use clap::value_parser;
use desktop_backend::BackendBuilder;
#[tokio::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();
    let matches = command!()
        .arg(
            arg!(
                -p --port <PORT> "Backend port"
            )
            .value_parser(value_parser!(u16))
            .required(false),
        )
        .arg(
            arg!(
                -t --token <TOKEN> "Worker token"
            )
            .required(false),
        )
        .get_matches();

    let token = if let Some(token) = matches.get_one::<String>("token") {
        token.clone()
    } else {
        "SECRET_TOKEN".to_string() // TODO: generate random
    };

    let mut backend = BackendBuilder::new().with_token(token.clone());
    if let Some(port) = matches.get_one::<u16>("port") {
        backend = backend.with_port(*port);
    }

    let local_addr = backend.bind().unwrap();
    log::info!("starting backend on http://{:?}", local_addr);
    backend.serve().await
}
