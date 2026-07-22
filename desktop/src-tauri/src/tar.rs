use anyhow::{bail, ensure, Context, Result};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom::Start},
    ops::Range,
    string::FromUtf8Error,
};

pub const TAR_BLOCK_SIZE: u64 = 512;

#[derive(Debug, PartialEq)]
pub struct TarHeader {
    pub path: String,
    pub size: u64,
}

impl TarHeader {
    fn encode_string(
        buffer: &mut [u8],
        offset: usize,
        length: usize,
        x: &str,
    ) -> anyhow::Result<()> {
        let bytes = x.as_bytes();
        ensure!(
            bytes.len() <= length,
            "field did not fit (required={}, available={})",
            bytes.len(),
            length
        );
        buffer[offset..offset + bytes.len()].copy_from_slice(bytes);
        Ok(())
    }

    fn encode_octal_number(
        buffer: &mut [u8],
        offset: usize,
        length: usize,
        x: u64,
    ) -> anyhow::Result<()> {
        let str = format!("{x:0length$o} ", length = length - 1);
        Self::encode_string(buffer, offset, length, &str)
    }

    pub fn as_bytes(&self) -> anyhow::Result<Vec<u8>> {
        let mut buffer = vec![0u8; TAR_BLOCK_SIZE as usize];

        // offsets are from https://en.wikipedia.org/w/index.php?title=Tar_(computing)&oldid=1363986389

        // path
        Self::encode_string(&mut buffer, 0, 100, &self.path)
            .with_context(|| "while encoding path of tar entry")?;
        // mode
        Self::encode_octal_number(&mut buffer, 100, 8, 0)?;
        // owner
        Self::encode_octal_number(&mut buffer, 108, 8, 0)?;
        // group
        Self::encode_octal_number(&mut buffer, 116, 8, 0)?;
        // file size TODO: handle big files (> 8Gib)
        Self::encode_octal_number(&mut buffer, 124, 12, self.size)
            .with_context(|| "while encoding file_size of tar entry")?;
        // mtime
        Self::encode_octal_number(&mut buffer, 136, 12, 0)?;
        // checksum (will be patched later; see below)
        Self::encode_string(&mut buffer, 148, 8, "        ")?;
        // link indicator
        Self::encode_string(&mut buffer, 156, 1, "0")?;
        // name of linked file
        Self::encode_string(&mut buffer, 157, 100, "")?;
        // ustar magic
        Self::encode_string(&mut buffer, 257, 5, "ustar")?;
        // ustar version
        Self::encode_string(&mut buffer, 263, 2, "00")?;
        // owner user name
        Self::encode_string(&mut buffer, 265, 32, "")?;
        // owner group name
        Self::encode_string(&mut buffer, 297, 32, "")?;
        // device major number
        Self::encode_octal_number(&mut buffer, 329, 8, 0)?;
        // device minor number
        Self::encode_octal_number(&mut buffer, 337, 8, 0)?;
        // filename prefix
        Self::encode_string(&mut buffer, 345, 155, "")?;

        // update checksum
        let checksum = buffer.iter().map(|x| *x as u64).sum();
        Self::encode_octal_number(&mut buffer, 148, 8, checksum)?;

        Ok(buffer)
    }

    fn read_zero_delimited_string(buffer: &[u8]) -> Result<std::string::String, FromUtf8Error> {
        let nul_range_end = buffer
            .iter()
            .position(|&c| c == b'\0')
            .unwrap_or(buffer.len());
        String::from_utf8(buffer[0..nul_range_end].to_vec())
    }

    pub fn from_bytes(bytes: &[u8]) -> anyhow::Result<Self> {
        ensure!(
            &bytes[257..257 + 5] == "ustar".as_bytes(),
            "tar header did not match 'ustar' signature at offset 257"
        );
        let path = Self::read_zero_delimited_string(&bytes[0..100])?;
        let size = u64::from_str_radix(
            Self::read_zero_delimited_string(&bytes[124..124 + 12])?.trim_end_matches(" "),
            8,
        )?;

        Ok(Self { path, size })
    }
}

pub fn get_byte_range_of_file_in_tar(tar_file: &mut File, path_in_tar: &str) -> Result<Range<u64>> {
    let file_len = tar_file.metadata().unwrap().len();
    let mut offset = 0;
    while offset + TAR_BLOCK_SIZE <= file_len {
        tar_file.seek(Start(offset))?;
        let mut buf = vec![0u8; TAR_BLOCK_SIZE as usize];
        tar_file.read_exact(&mut buf)?;
        let header = TarHeader::from_bytes(&buf)?;
        offset += TAR_BLOCK_SIZE;
        if header.path == path_in_tar {
            return Ok(offset..offset + header.size);
        }
        offset = (offset + header.size).div_ceil(TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    }
    bail!("could not find a file with path '{path_in_tar}' in tar")
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_roundtrip() {
        let initial = TarHeader {
            path: "some value".to_string(),
            size: 42,
        };
        let encoded = initial.as_bytes().unwrap();
        assert_eq!(encoded.len(), TAR_BLOCK_SIZE as usize);
        let decoded = TarHeader::from_bytes(&encoded).unwrap();
        assert_eq!(initial, decoded);
    }

    #[test]
    fn test_get_byte_range_of_file_in_tar() {
        let mut file = File::open("../test-data/sample.transcribee").unwrap();
        let data_range = get_byte_range_of_file_in_tar(&mut file, "document.automerge").unwrap();
        assert_eq!(data_range, 198144..200117);

        let data_range = get_byte_range_of_file_in_tar(&mut file, "media").unwrap();
        assert_eq!(data_range, 512..197450);

        file.seek(Start(data_range.start)).unwrap();
        let mut buf = vec![0u8; (data_range.end - data_range.start) as usize];
        file.read_exact(&mut buf).unwrap();
    }
}
