use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    InsufficientBalance, // Insufficient balance to withdraw the requested amount.
    OrderHeapFull, // Order heap is full and cannot accept new orders.
    OrderNotFound, // The specified order was not found in the heap.

    InvalidArguments, // Invalid arguments provided to the instruction.
}