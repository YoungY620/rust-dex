use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::state::VaultTokenLedgerAccount;
use crate::state::IndividualTokenLedgerAccount;
use crate::market_seeds;
use crate::state::INDIVIDUAL_TOKEN_LEDGER_SEED;
use crate::state::VAULT_TOKEN_LEDGER_SEED;

#[error_code]
pub enum ErrorCode {
    InsufficientBalance,
}

pub fn withdraw_impl(ctx: Context<Withdraw>, _mint_account: Pubkey, amount: u64) -> Result<()> {
    msg!("Withdraw amount: {}", amount);
    let user_balance = ctx.accounts.user_token_ledger.available_balance;
    if user_balance < amount {
        return Err(ErrorCode::InsufficientBalance.into());
    }
    // Transfer tokens from vault token account to user token account
    let signer_seeds: &[&[&[u8]]] = &[market_seeds!(ctx.accounts.vault_token_ledger, _mint_account)];
    let cpi_accounts = anchor_spl::token::Transfer {
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.vault_token_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(
        cpi_program, cpi_accounts, signer_seeds
    );
    anchor_spl::token::transfer(cpi_ctx, amount)?;
    
    Ok(())
}


#[derive(Accounts)]
#[instruction(_mint_account: Pubkey)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [VAULT_TOKEN_LEDGER_SEED, _mint_account.key().as_ref()],
        bump = vault_token_ledger.bump,
        has_one = vault_token_account
    )]
    pub vault_token_ledger: Account<'info, VaultTokenLedgerAccount>,
    /// CHECK: This is a PDA used as token authority, derived from seeds
    #[account(
        seeds = [b"vault_token_account", _mint_account.key().as_ref()],
        bump = vault_token_ledger.authority_bump
    )]
    pub vault_token_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [INDIVIDUAL_TOKEN_LEDGER_SEED, _mint_account.key().as_ref(),
        user.key().as_ref()],
        bump = user_token_ledger.bump,
        has_one = user_token_account
    )]
    pub user_token_ledger: Account<'info, IndividualTokenLedgerAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}


