use crate::{
    range_util::{RangeChunks, RangeLen},
    tar::{
        get_byte_range_of_file_in_tar, get_bytes_of_file_in_tar, pad_file_to_next_tar_block,
        TarHeader, TAR_BLOCK_SIZE,
    },
};
use anyhow::{bail, Context, Result};
use log::warn;
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom::Start, Write},
    ops::Range,
};

pub fn create_new(
    path: &str,
    media_file: Option<MediaFileSource>,
    automerge_doc: &[u8],
) -> Result<()> {
    let mut file = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
        .with_context(|| {
            format!("while trying to open file in transcribe_archive::create_new with path={path}")
        })?;

    if let Some(media_file) = media_file {
        file.write_all(
            &TarHeader {
                path: "media".to_string(),
                size: media_file.len()?,
            }
            .as_bytes()?,
        )?;
        // we copy the file in chunks of 10Mb to avoid having to load it into memory in full
        for chunk in (0..media_file.len()?).chunks(10_000_000) {
            let buf = media_file
                .get_bytes(chunk.clone())
                .with_context(|| format!("while trying to media_file.get_bytes({chunk:?}) in transcribe_archive::create_new with path={path}"))?;
            file.write_all(&buf)?;
        }
        pad_file_to_next_tar_block(&mut file)?;
    }

    file.write_all(
        &TarHeader {
            path: "document.automerge".to_string(),
            size: automerge_doc.len() as u64,
        }
        .as_bytes()?,
    )?;
    file.write_all(automerge_doc)?;
    Ok(())
}

pub fn append_automerge_change(path: &str, change: &[u8]) -> Result<()> {
    let mut file = File::options()
        .read(true)
        .write(true)
        .open(path)
        .with_context(|| {
            format!("while trying to open file in transcribe_archive::update_automerge_file with path={path}")
        })?;

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

pub fn update_automerge_file(path: &str, new_automerge_doc: &[u8]) -> Result<()> {
    let mut file = File::options()
        .read(true)
        .write(true)
        .open(path)
        .with_context(|| {
            format!("while trying to open file in transcribe_archive::update_automerge_file with path={path}")
        })?;
    let len = file.metadata()?.len();
    let old_automerge_doc = get_automerge_doc(path)?;
    if new_automerge_doc[0..old_automerge_doc.len()] != old_automerge_doc {
        warn!("old automerge doc does not match beginning of automerge doc, this sounds bad");
        let automerge_range: Range<u64> =
            get_byte_range_of_file_in_tar(&mut file, "document.automerge")?;
        file.seek(Start(automerge_range.start))?;
        if automerge_range.end != len {
            // this is only a warning because if transcribee crashes between writing the file and updating the tar header
            // (see below), we can get a tar file where document.automerge is not right at the end
            warn!(
                "document.automerge is not at the end of the archive. (document.automerge end: {}; file length: {})",
                automerge_range.end, len
            );
        }
        file.write_all(new_automerge_doc)?;
        file.seek(Start(automerge_range.start - TAR_BLOCK_SIZE))?;
        file.write_all(
            &TarHeader {
                path: "document.automerge".to_string(),
                size: new_automerge_doc.len() as u64,
            }
            .as_bytes()?,
        )?;
    } else {
        append_automerge_change(path, &new_automerge_doc[old_automerge_doc.len()..])?
    }
    Ok(())
}

pub fn get_automerge_doc(path: &str) -> Result<Vec<u8>> {
    let mut file = File::open(path).with_context(|| {
        format!(
            "while trying to open file in transcribe_archive::get_automerge_doc with path={path}"
        )
    })?;
    get_bytes_of_file_in_tar(&mut file, "document.automerge").with_context(|| {
        format!("while get_bytes_of_file_in_tar in transcribe_archive::get_automerge_doc with path={path}")
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MediaFileSource {
    Fs {
        media_path: String,
    },
    InTar {
        archive_path: String,
        path_in_archive: String,
    },
}
impl MediaFileSource {
    pub fn len(&self) -> Result<u64> {
        match self {
            MediaFileSource::Fs { media_path } => {
                let file = File::open(media_path)
                    .with_context(|| format!("could not open media file '{}'", media_path))?;
                Ok(file.metadata()?.len())
            }
            MediaFileSource::InTar {
                archive_path,
                path_in_archive,
            } => {
                let mut file = File::open(archive_path)
                    .with_context(|| format!("could not open archive file '{}'", archive_path))?;
                let file_range = get_byte_range_of_file_in_tar(&mut file, path_in_archive)?;
                Ok(file_range.len())
            }
        }
    }
    pub fn get_bytes(&self, range: Range<u64>) -> Result<Vec<u8>> {
        match self {
            MediaFileSource::Fs { media_path } => {
                let mut file = File::open(media_path)
                    .with_context(|| format!("could not open media file '{}'", media_path))?;
                file.seek(Start(range.start))?;
                let mut buf = vec![0u8; range.len() as usize];
                file.read_exact(&mut buf)?;
                Ok(buf)
            }
            MediaFileSource::InTar {
                archive_path,
                path_in_archive,
            } => {
                let mut file = File::open(archive_path)
                    .with_context(|| format!("could not open archive file '{}'", archive_path))?;
                let file_range = get_byte_range_of_file_in_tar(&mut file, path_in_archive)?;
                if file_range.start + range.end > file_range.end {
                    bail!("tried to read past end of file in tar")
                }
                file.seek(Start(file_range.start + range.start))?;
                let mut buf = vec![0u8; range.len() as usize];
                file.read_exact(&mut buf)?;
                Ok(buf)
            }
        }
    }
}
