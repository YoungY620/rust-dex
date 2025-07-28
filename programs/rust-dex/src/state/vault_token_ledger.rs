use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount, Token};


#[account]
pub struct VaultTokenLedgerAccount {
    pub total_balance: u64,
    pub mint_account: Pubkey,
    pub vault_token_account: Pubkey,
    pub bump: u8,
    pub authority_bump: u8, // authority bump for vault_token_account
}