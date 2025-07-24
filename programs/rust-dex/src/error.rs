use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("OrderBook not initialized")]
    OrderBookNotInitialized,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Overflow")]
    Overflow,
    #[msg("Underflow")]
    Underflow,
    #[msg("Invalid order side")]
    InvalidOrderSide,
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Market not initialized")]
    MarketNotInitialized,
}
