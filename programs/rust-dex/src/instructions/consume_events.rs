use anchor_lang::prelude::*;
use crate::state::EventList;
use crate::state::ORDER_EVENTS_SEED;
use crate::INDIVIDUAL_TOKEN_LEDGER_SEED;
use crate::state::IndividualTokenLedgerAccount;

#[error_code]
pub enum ErrorCode {
    #[msg("The opposite user key need to be consistent to next event.")]
    InconsistentUserKey,
}

pub fn consume_event_impl(ctx: Context<ConsumeEvents>, opposite_user_key: Pubkey) -> Result<()> {
    let event_list: &mut EventList = &mut ctx.accounts.event_list;
    let user_token_income_ledger: &mut IndividualTokenLedgerAccount = &mut ctx.accounts.user_token_income_ledger;
    let user_token_outcome_ledger: &mut IndividualTokenLedgerAccount = &mut ctx.accounts.user_token_outcome_ledger;
    let opposite_user_token_income_ledger: &mut IndividualTokenLedgerAccount = &mut ctx.accounts.opposite_user_token_income_ledger;
    let opposite_user_token_outcome_ledger: &mut IndividualTokenLedgerAccount = &mut ctx.accounts.opposite_user_token_outcome_ledger;
    if event_list.is_closed() {
        return Ok(());
    }

    let next_event;
    match event_list.pop() {
        Some(event) => next_event = event,
        None => return Ok(()),
    };

    if next_event.rollback {
        user_token_outcome_ledger.locked_balance -= next_event.sell_quantity;
        user_token_outcome_ledger.available_balance += next_event.sell_quantity;
    }else {
        if next_event.oppo_user != opposite_user_key {
            return Err(ErrorCode::InconsistentUserKey.into());
        }
        user_token_outcome_ledger.locked_balance -= next_event.sell_quantity;
        opposite_user_token_outcome_ledger.locked_balance -= next_event.buy_quantity;
        user_token_income_ledger.available_balance += next_event.buy_quantity;
        opposite_user_token_income_ledger.available_balance += next_event.sell_quantity;
    }

    if event_list.length() == 0 {
        event_list.close();
    } 
    Ok(())
}

#[derive(Accounts)]
#[instruction(opposite_user_key: Pubkey)]
pub struct ConsumeEvents<'info> {
    #[account(
        mut,
        seeds = [ORDER_EVENTS_SEED, user.key().as_ref()],
        bump = event_list.bump,
        has_one = user
    )]
    pub event_list: Account<'info, EventList>,
    #[account(
        mut, 
        seeds = [INDIVIDUAL_TOKEN_LEDGER_SEED, user_token_income_ledger.mint_account.as_ref(), user.key().as_ref()], 
        bump = user_token_income_ledger.bump
    )]
    pub user_token_income_ledger: Account<'info, IndividualTokenLedgerAccount>,
    #[account(
        mut, 
        seeds = [INDIVIDUAL_TOKEN_LEDGER_SEED, user_token_outcome_ledger.mint_account.as_ref(), user.key().as_ref()], 
        bump = user_token_outcome_ledger.bump
    )]
    pub user_token_outcome_ledger: Account<'info, IndividualTokenLedgerAccount>,
    #[account(
        mut,
        seeds = [INDIVIDUAL_TOKEN_LEDGER_SEED, opposite_user_token_income_ledger.mint_account.as_ref(), opposite_user_key.as_ref()],
        bump = opposite_user_token_income_ledger.bump
    )]
    pub opposite_user_token_income_ledger: Account<'info, IndividualTokenLedgerAccount>,
    #[account(
        mut,
        seeds = [INDIVIDUAL_TOKEN_LEDGER_SEED, opposite_user_token_outcome_ledger.mint_account.as_ref(), opposite_user_key.as_ref()],
        bump = opposite_user_token_outcome_ledger.bump
    )]
    pub opposite_user_token_outcome_ledger: Account<'info, IndividualTokenLedgerAccount>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}