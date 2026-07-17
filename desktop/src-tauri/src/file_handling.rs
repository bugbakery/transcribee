use rawzip::ReaderAt;
use rawzip::{ZipArchive, RECOMMENDED_BUFFER_SIZE};
use std::fs::File;
use tauri::{command, ipc::Response};

#[command]
pub async fn read_automerge(path: String) -> Result<Response, String> {
    let file = File::open(path).map_err(|e| format!("{:?}", e))?;
    let mut buf = vec![0u8; RECOMMENDED_BUFFER_SIZE];
    let zip = ZipArchive::from_file(file, &mut buf).map_err(|e| format!("{:?}", e))?;

    let mut data_range = None;
    let mut entries = zip.entries(&mut buf);
    while let Some(entry) = entries.next_entry().map_err(|e| format!("{:?}", e))? {
        if entry.file_path().as_bytes() == "document.automerge".as_bytes() {
            if entry.compression_method() != rawzip::CompressionMethod::STORE {
                return Err(
                    "document.automerge is not uncompressed. only uncompressed files are supported"
                        .to_string(),
                );
            }
            let local_entry = zip
                .get_entry(entry.wayfinder())
                .map_err(|e| format!("{:?}", e))?;
            data_range = Some(local_entry.compressed_data_range());
            break;
        }
    }
    let data_range = data_range.ok_or("could not find document.automerge in zip file")?;
    let file = zip.into_inner();
    let mut buf = vec![0u8; (data_range.1 - data_range.0) as usize];
    file.read_exact_at(&mut buf, data_range.0)
        .map_err(|e| format!("{:?}", e))?;

    return Ok(tauri::ipc::Response::new(buf));
}
