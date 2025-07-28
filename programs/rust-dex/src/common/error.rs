use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    InsufficientBalance, // Insufficient balance to withdraw the requested amount.
    OrderHeapFull, // Order heap is full and cannot accept new orders.
    OrderNotFound, // The specified order was not found in the heap.
    EventListFull, // The event list is full and cannot accept new events.

    InvalidTokenPair, // Invalid arguments provided to the instruction.
    InvalidOrderSide, // The order side must be either "buy" or "sell".
}