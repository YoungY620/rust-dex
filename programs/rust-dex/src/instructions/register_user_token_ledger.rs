use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};
use crate::state::IndividualTokenLedgerAccount;
use crate::state::INDIVIDUAL_TOKEN_LEDGER_SEED;
use crate::IndividualLedgerAccount;
use crate::INDIVIDUAL_LEDGER_SEED;

pub fn register_user_token_ledger_impl(ctx: Context<RegisterUserTokenLedger>, mint_account: Pubkey) -> Result<()> {
    msg!("Registering user token ledger with mint: {:?} and user account: {:?}", 
        mint_account, ctx.accounts.user_token_account.key());
    let user_token_ledger: &mut IndividualTokenLedgerAccount = &mut ctx.accounts.user_token_ledger;

    user_token_ledger.mint_account = mint_account;
    user_token_ledger.user_token_account = ctx.accounts.user_token_account.key();
    user_token_ledger.available_balance = 0;
    user_token_ledger.locked_balance = 0;
    user_token_ledger.bump = ctx.bumps.user_token_ledger;

    let individual_ledger: &mut IndividualLedgerAccount = &mut ctx.accounts.individual_ledger;
    individual_ledger.add_token(mint_account)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(mint_account: Pubkey)]
pub struct RegisterUserTokenLedger<'info> {
    #[account(
        init,
        payer = user,
        seeds = [INDIVIDUAL_TOKEN_LEDGER_SEED, mint_account.key().as_ref(), user.key().as_ref()],
        bump,
        space = 8 + 16 + 16 + 32 + 32 + 1
    )]
    pub user_token_ledger: Account<'info, IndividualTokenLedgerAccount>,
    #[account(
        mut,
        seeds = [INDIVIDUAL_LEDGER_SEED, user.key().as_ref()],
        bump,
    )]
    pub individual_ledger: Box<Account<'info, IndividualLedgerAccount>>,
    pub mint_account: Account<'info, Mint>,
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}


