use anchor_lang::prelude::*;

pub const VAULT_TOKEN_LEDGER_SEED: &[u8] = b"vault_token_ledger";

#[account]
pub struct VaultTokenLedgerAccount {
    pub total_balance: u64,
    pub mint_account: Pubkey,
    pub vault_token_account: Pubkey,
    pub bump: u8,
    pub authority_bump: u8, // authority bump for vault_token_account
}