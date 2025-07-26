use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::instructions::*;
use anchor_spl::token;


pub fn deposit_impl(ctx: Context<Deposit>, _mint_account: Pubkey, amount: u64) -> Result<()> {
    msg!("Deposit amount: {}", amount);
    let cpi_accounts = anchor_spl::token::Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(_mint_account: Pubkey)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"vault_token_ledger", _mint_account.key().as_ref()],
        bump = vault_token_ledger.bump,
        has_one = vault_token_account
    )]
    pub vault_token_ledger: Account<'info, VaultTokenLedgerAccount>,
     #[account(
        mut,
        seeds = [b"individual_token_ledger", _mint_account.key().as_ref(), user.key().as_ref()],
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