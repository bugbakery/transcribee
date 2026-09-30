//! Stream processing is done in pull mode here
//! that means, that each processing step requests its dependencies from an upstream block.
//! Each block is responsible for caching its own computations.
