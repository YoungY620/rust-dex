use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount, Token};
use crate::state::VaultTokenLedgerAccount;
use crate::state::VAULT_TOKEN_LEDGER_SEED;

pub fn register_vault_token_ledger_impl(ctx: Context<RegisterVaultTokenLedger>) -> Result<()> {
    
    msg!("Registering vault token ledger with mint: {:?} and vault account: {:?}", 
        ctx.accounts.mint_account.key(), ctx.accounts.vault_token_account.key());
    let vault_token_ledger: &mut VaultTokenLedgerAccount = &mut ctx.accounts.vault_token_ledger;

    vault_token_ledger.mint_account = ctx.accounts.mint_account.key();
    vault_token_ledger.vault_token_account = ctx.accounts.vault_token_account.key();
    vault_token_ledger.bump = ctx.bumps.vault_token_ledger;
    vault_token_ledger.total_balance = 0;
    vault_token_ledger.authority_bump = ctx.bumps.vault_token_authority;
    Ok(())  
}


#[derive(Accounts)]
pub struct RegisterVaultTokenLedger<'info> {
    #[account(
        init, 
        payer = user,
        seeds = [VAULT_TOKEN_LEDGER_SEED, mint_account.key().as_ref()],
        bump,
        space = 8 + 16 + 32 + 32 + 1 + 1 
    )]
    pub vault_token_ledger: Account<'info, VaultTokenLedgerAccount>,
    /// CHECK: This is a PDA used as token authority, derived from seeds
    #[account(
        seeds = [b"vault_token_account", mint_account.key().as_ref()],
        bump
    )]
    pub vault_token_authority: UncheckedAccount<'info>,
    pub mint_account: Account<'info, Mint>,
    #[account(
        init,
        payer = user,
        token::mint = mint_account,
        token::authority = vault_token_authority       
        // use vault_token_ledger as authority, so user can withdraw without other authorities
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>, // needed by vault_token_account's initialization
}
