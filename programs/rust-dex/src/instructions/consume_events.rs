use anchor_lang::prelude::*;
use crate::state::EventList;
use crate::state::ORDER_EVENTS_SEED;
use crate::INDIVIDUAL_TOKEN_LEDGER_SEED;
use crate::state::IndividualTokenLedgerAccount;

#[error_code]
pub enum ErrorCode {
    #[msg("The event list is closed.")]
    EventListClosed,
    #[msg("Invalid event type.")]
    InvalidArgument,
}
#[derive(Debug, Clone, PartialEq)]
enum ConsumeEventsSuccess {
    Completed,
    Partial,
}

pub fn consume_events(ctx: Context<ConsumeEvents>) -> Result<ConsumeEventsSuccess> {
    let event_list: &mut EventList = &mut ctx.accounts.event_list;
    let user_token_ledger: &mut IndividualTokenLedgerAccount = &mut ctx.accounts.user_token_ledger;
    let opposite_user_token_ledger: &mut IndividualTokenLedgerAccount = &mut ctx.accounts.opposite_user_token_ledger;
    if event_list.is_closed() {
        return Err(ErrorCode::EventListClosed.into());
    }
    if event_list.length() == 0 {
        return Ok(ConsumeEventsSuccess::Completed);
    }

    

    Ok(ConsumeEventsSuccess::Completed)
}

#[derive(Accounts)]
pub struct ConsumeEvents<'info> {
    #[account(
        mut,
        seeds = [ORDER_EVENTS_SEED],
        bump = event_list.bump
    )]
    pub event_list: Account<'info, EventList>,
    #[account(
        mut, 
        seeds = [INDIVIDUAL_TOKEN_LEDGER_SEED, user_token_ledger.mint_account.as_ref(), user.key().as_ref()], 
        bump = user_token_ledger.bump
    )]
    pub user_token_ledger: Account<'info, IndividualTokenLedgerAccount>,
    #[account(
        mut,
        seeds = [INDIVIDUAL_TOKEN_LEDGER_SEED, opposite_user_token_ledger.mint_account.as_ref(), opposite_user.key().as_ref()],
        bump = opposite_user_token_ledger.bump
    )]
    pub opposite_user_token_ledger: Account<'info, IndividualTokenLedgerAccount>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}