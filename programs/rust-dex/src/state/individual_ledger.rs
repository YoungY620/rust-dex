use anchor_lang::prelude::*;
use crate::common::MAX_TOKEN_MINTS;

pub const INDIVIDUAL_LEDGER_SEED: &[u8] = b"user_ledger";
pub const USER_ORDERBOOK_SEED: &[u8] = b"user_orderbook";
pub const INDIVIDUAL_TOKEN_LEDGER_SEED: &[u8] = b"individual_token_ledger";

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