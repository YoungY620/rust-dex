use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    InsufficientBalance, // Insufficient balance to withdraw the requested amount.
}