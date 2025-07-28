use anchor_lang::prelude::*;
use crate::common::MAX_TOKEN_MINTS;

#[account]
pub struct IndividualLedgerAccount {
    pub tokens: [Pubkey; MAX_TOKEN_MINTS],
    pub next_index: u16,
    pub bitmap: [u8; MAX_TOKEN_MINTS],
    pub bump: u8,
}

#[account]
pub struct UserOrderbook {
    pub orders: [u128; MAX_TOKEN_MINTS],
    pub next_index: u16,
    pub bitmap: [u8; MAX_TOKEN_MINTS],
    pub bump: u8,
}

#[account]
pub struct IndividualTokenLedgerAccount {
    pub available_balance: u64,
    pub locked_balance: u64,
    pub mint_account: Pubkey,
    pub user_token_account: Pubkey,
    pub bump: u8,
}