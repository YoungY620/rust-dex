use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};
use crate::state::IndividualTokenLedgerAccount;

pub fn register_user_token_ledger_impl(ctx: Context<RegisterUserTokenLedger>, mint_account: Pubkey) -> Result<()> {
    msg!("Registering user token ledger with mint: {:?} and user account: {:?}", 
        mint_account, ctx.accounts.user_token_account.key());
    let user_token_ledger: &mut IndividualTokenLedgerAccount = &mut ctx.accounts.user_token_ledger;

    user_token_ledger.mint_account = mint_account;
    user_token_ledger.user_token_account = ctx.accounts.user_token_account.key();
    user_token_ledger.available_balance = 0;
    user_token_ledger.locked_balance = 0;
    user_token_ledger.bump = ctx.bumps.user_token_ledger;
    Ok(())
}

#[derive(Accounts)]
#[instruction(mint_account: Pubkey)]
pub struct RegisterUserTokenLedger<'info> {
    #[account(
        init,
        payer = user,
        seeds = [b"individual_token_ledger", mint_account.key().as_ref(), user.key().as_ref()],
        bump,
        space = 8 + 16 + 16 + 32 + 32 + 1
    )]
    pub user_token_ledger: Account<'info, IndividualTokenLedgerAccount>,
    pub mint_account: Account<'info, Mint>,
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}


