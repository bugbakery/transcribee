use std::ops::Range;

pub trait RangeLen {
    fn len(&self) -> u64;
}
impl RangeLen for Range<u64> {
    fn len(&self) -> u64 {
        self.end - self.start
    }
}

pub trait RangeChunks {
    fn chunks(&self, chunk_size: u64) -> RangeChunkIterator;
}
impl RangeChunks for Range<u64> {
    fn chunks(&self, chunk_size: u64) -> RangeChunkIterator {
        RangeChunkIterator {
            range: self.clone(),
            current_chunk: 0,
            chunk_size,
        }
    }
}
pub struct RangeChunkIterator {
    range: Range<u64>,
    current_chunk: u64,
    chunk_size: u64,
}
impl Iterator for RangeChunkIterator {
    type Item = Range<u64>;
    fn next(&mut self) -> Option<Self::Item> {
        let num_chunks = self.range.len().div_ceil(self.chunk_size);
        if self.current_chunk == num_chunks {
            None
        } else if self.current_chunk == num_chunks - 1 {
            let chunk = self.range.start + self.current_chunk * self.chunk_size..self.range.end;
            self.current_chunk += 1;
            Some(chunk)
        } else {
            let chunk = self.range.start + self.current_chunk * self.chunk_size
                ..self.range.start + (self.current_chunk + 1) * self.chunk_size;
            self.current_chunk += 1;
            Some(chunk)
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_range_chunks() {
        assert_eq!(
            (0..10).chunks(2).collect::<Vec<_>>(),
            vec![0..2, 2..4, 4..6, 6..8, 8..10]
        );
        assert_eq!(
            (0..10).chunks(3).collect::<Vec<_>>(),
            vec![0..3, 3..6, 6..9, 9..10]
        );
        assert_eq!(
            (10..20).chunks(2).collect::<Vec<_>>(),
            vec![10..12, 12..14, 14..16, 16..18, 18..20]
        );
        assert_eq!(
            (10..20).chunks(3).collect::<Vec<_>>(),
            vec![10..13, 13..16, 16..19, 19..20]
        );
    }
}
