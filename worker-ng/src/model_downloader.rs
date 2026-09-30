use anyhow::{Context, Result};
use futures::stream::StreamExt;
use std::{fs, io::Write, path::PathBuf};

pub const MODELS_BASE_PATH: &'static str = "./target/";

pub struct RemoteModel {
    pub url: &'static str,
    pub name: &'static str,
    pub size: u64,
}
impl RemoteModel {
    pub async fn ensure_downloaded(
        &self,
        mut progress_callback: impl FnMut(u64, u64),
    ) -> Result<PathBuf> {
        let local_path = self.local_path();
        if local_path.exists() {
            if local_path
                .metadata()
                .with_context(|| format!("could not get length of  file {local_path:?}"))?
                .len()
                == self.size
            {
                return Ok(local_path);
            } else {
                fs::remove_file(&local_path)
                    .with_context(|| format!("could not delete file {local_path:?}"))?
            }
        }

        let res = reqwest::get(self.url).await?;
        let total_size = res
            .content_length()
            .with_context(|| format!("Failed to get content length from '{}'", self.url))?;

        let mut file = fs::File::create(&local_path)
            .with_context(|| format!("Failed to create file '{local_path:?}'"))?;

        let mut downloaded: u64 = 0;
        let mut stream = res.bytes_stream();

        while let Some(item) = stream.next().await {
            let chunk = item.context("Error while downloading file")?;
            file.write_all(&chunk)
                .context("Error while writing to file")?;
            downloaded += chunk.len() as u64;
            progress_callback(downloaded, total_size)
        }

        Ok(local_path)
    }

    fn local_path(&self) -> PathBuf {
        let base = PathBuf::from(MODELS_BASE_PATH);
        base.join(self.name)
    }
}
