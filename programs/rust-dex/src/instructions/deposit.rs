use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use anchor_spl::token;
use crate::state::{VaultTokenLedgerAccount, IndividualTokenLedgerAccount};
use crate::state::INDIVIDUAL_TOKEN_LEDGER_SEED;
use crate::state::VAULT_TOKEN_LEDGER_SEED;

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
    // Update ledger balances
    let user_ledger = &mut ctx.accounts.user_token_ledger;
    let vault_ledger = &mut ctx.accounts.vault_token_ledger;
    user_ledger.available_balance = user_ledger.available_balance.checked_add(amount).unwrap();
    vault_ledger.total_balance = vault_ledger.total_balance.checked_add(amount).unwrap();
    Ok(())
}

#[derive(Accounts)]
#[instruction(_mint_account: Pubkey)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [VAULT_TOKEN_LEDGER_SEED, _mint_account.key().as_ref()],
        bump = vault_token_ledger.bump,
        has_one = vault_token_account
    )]
    pub vault_token_ledger: Account<'info, VaultTokenLedgerAccount>,
     #[account(
        mut,
        seeds = [INDIVIDUAL_TOKEN_LEDGER_SEED, _mint_account.key().as_ref(), user.key().as_ref()],
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