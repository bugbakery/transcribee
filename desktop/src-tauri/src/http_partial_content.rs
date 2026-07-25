use anyhow::Result;
use http::{
    header::{ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE},
    response::Builder as ResponseBuilder,
    HeaderValue, StatusCode,
};
use http_range::HttpRange;
use std::{io::Write, ops::Range};

// this is stolen and adapted from
// https://github.com/tauri-apps/tauri/blob/3f62c70d6b9a9eeeb7c302b010c858405a1bb761/examples/streaming/main.rs#L15
pub fn http_response_maybe_partial(
    range_header: Option<&HeaderValue>,
    mut get_content: impl FnMut(Range<u64>) -> Result<Vec<u8>>,
    total_len: u64,
    mime_type: &str,
) -> Result<http::Response<Vec<u8>>> {
    let resp = ResponseBuilder::new().header(ACCESS_CONTROL_ALLOW_ORIGIN, "*");

    let http_response = match range_header {
        None => resp
            .header(CONTENT_TYPE, mime_type)
            .header(CONTENT_LENGTH, total_len)
            .body(get_content(0..total_len)?),

        Some(range_header) => {
            let not_satisfiable = || {
                ResponseBuilder::new()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(CONTENT_RANGE, format!("bytes */{total_len}"))
                    .body(vec![])
            };

            let ranges = if let Ok(ranges) = HttpRange::parse(range_header.to_str()?, total_len) {
                ranges
                    .iter()
                    // map the output back to spec range <start-end>, example: 0-499
                    .map(|r| (r.start, r.start + r.length - 1))
                    .collect::<Vec<_>>()
            } else {
                return Ok(not_satisfiable()?);
            };

            /// The Maximum bytes we send in one range
            const MAX_LEN: u64 = 1000 * 1024;

            if ranges.len() == 1 {
                let &(start, mut end) = ranges.first().unwrap();

                // check if a range is not satisfiable
                //
                // this should be already taken care of by HttpRange::parse
                // but checking here again for extra assurance
                if start >= total_len || end >= total_len || end < start {
                    return Ok(not_satisfiable()?);
                }

                // adjust end byte for MAX_LEN
                end = start + (end - start).min(total_len - start).min(MAX_LEN - 1);
                let buf = get_content(start..end + 1)?;
                resp.header(CONTENT_TYPE, mime_type)
                    .header(CONTENT_RANGE, format!("bytes {start}-{end}/{total_len}"))
                    .header(CONTENT_LENGTH, end + 1 - start)
                    .status(StatusCode::PARTIAL_CONTENT)
                    .body(buf)
            } else {
                let mut buf = Vec::new();
                let ranges = ranges
                    .iter()
                    .filter_map(|&(start, mut end)| {
                        // filter out unsatisfiable ranges
                        //
                        // this should be already taken care of by HttpRange::parse
                        // but checking here again for extra assurance
                        if start >= total_len || end >= total_len || end < start {
                            None
                        } else {
                            // adjust end byte for MAX_LEN
                            end = start + (end - start).min(total_len - start).min(MAX_LEN - 1);
                            Some((start, end))
                        }
                    })
                    .collect::<Vec<_>>();

                let boundary = random_boundary();
                let boundary_sep = format!("\r\n--{boundary}\r\n");
                let boundary_closer = format!("\r\n--{boundary}\r\n");

                for (start, end) in ranges {
                    // a new range is being written, write the range boundary
                    buf.write_all(boundary_sep.as_bytes())?;

                    // write the needed headers `Content-Type` and `Content-Range`
                    buf.write_all(format!("{CONTENT_TYPE}: {mime_type}\r\n").as_bytes())?;
                    buf.write_all(
                        format!("{CONTENT_RANGE}: bytes {start}-{end}/{total_len}\r\n").as_bytes(),
                    )?;

                    // write the separator to indicate the start of the range body
                    buf.write_all("\r\n".as_bytes())?;

                    let local_buf = get_content(start..end + 1)?;
                    buf.extend_from_slice(&local_buf);
                }
                // all ranges have been written, write the closing boundary
                buf.write_all(boundary_closer.as_bytes())?;

                resp.header(
                    CONTENT_TYPE,
                    format!("multipart/byteranges; boundary={boundary}"),
                )
                .body(buf)
            }
        }
    };

    http_response.map_err(Into::into)
}

fn random_boundary() -> String {
    let mut x = [0_u8; 30];
    getrandom::fill(&mut x).expect("failed to get random bytes");
    (x[..])
        .iter()
        .map(|&x| format!("{x:x}"))
        .fold(String::new(), |mut a, x| {
            a.push_str(x.as_str());
            a
        })
}

#[cfg(test)]
pub mod test {
    use super::*;

    #[test]
    fn test_get_archive_response_whole() {
        let response = http_response_maybe_partial(
            None,
            |_range| return Ok(vec![0u8; 196938]),
            196938,
            "test/test",
        )
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().len(), 196938);
        assert_eq!(response.headers().get(CONTENT_LENGTH).unwrap(), "196938");
        assert_eq!(
            response.headers().get(ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(),
            "*"
        );
    }

    #[test]
    fn test_get_archive_response_single_range() {
        let len = 10_000;
        let mut x = vec![0_u8; len];
        getrandom::fill(&mut x).expect("failed to get random bytes");

        let full_response = http_response_maybe_partial(
            None,
            |range| Ok(x[range.start as usize..range.end as usize].to_vec()),
            len as u64,
            "test/test",
        )
        .unwrap();
        let full_body = full_response.body();

        let range_response = http_response_maybe_partial(
            Some(&HeaderValue::from_static("bytes=42-1337")),
            |range| Ok(x[range.start as usize..range.end as usize].to_vec()),
            len as u64,
            "test/test",
        )
        .unwrap();

        assert_eq!(range_response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            range_response.headers().get(CONTENT_LENGTH).unwrap(),
            &format!("{}", 1338 - 42)
        );
        assert_eq!(
            range_response
                .headers()
                .get(ACCESS_CONTROL_ALLOW_ORIGIN)
                .unwrap(),
            "*"
        );
        assert_eq!(range_response.body(), &full_body[42..1338])
    }
}
