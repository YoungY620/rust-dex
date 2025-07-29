use anchor_lang::prelude::*;
use crate::state::EventList;
use crate::state::ORDER_EVENTS_SEED;
use crate::INDIVIDUAL_TOKEN_LEDGER_SEED;
use crate::state::IndividualTokenLedgerAccount;
use crate::common::ErrorCode;


pub fn consume_event_impl(ctx: Context<ConsumeEvents>, opposite_user_key: Pubkey) -> Result<()> {
    let event_list: &mut EventList = &mut ctx.accounts.event_list;
    let user_token_income_ledger: &mut IndividualTokenLedgerAccount = &mut ctx.accounts.user_token_income_ledger;
    let user_token_outcome_ledger: &mut IndividualTokenLedgerAccount = &mut ctx.accounts.user_token_outcome_ledger;
    let opposite_user_token_income_ledger: &mut IndividualTokenLedgerAccount = &mut ctx.accounts.opposite_user_token_income_ledger;
    let opposite_user_token_outcome_ledger: &mut IndividualTokenLedgerAccount = &mut ctx.accounts.opposite_user_token_outcome_ledger;
    msg!("Event list: {:?}", event_list);
    if event_list.is_closed() {
        msg!("Event list is closed, nothing to consume.");
        return Ok(());
    }

    let next_event = event_list.pop();
    if next_event.is_none() {
        msg!("No more events to consume.");
        return Ok(());
    }
    let next_event = next_event.unwrap();
    
    if next_event.rollback {
        user_token_outcome_ledger.locked_balance -= next_event.sell_quantity;
        user_token_outcome_ledger.available_balance += next_event.sell_quantity;
    }else {
        if next_event.oppo_user != opposite_user_key {
            msg!("Event does not belong to the specified opposite user: {}, expected: {}", opposite_user_key, next_event.oppo_user);
            return Err(ErrorCode::InvalidArgument.into());
        }
        msg!("Processing event: {:?}", next_event);
        msg!("User {:4} income: {} of token {:4} from user {:4} for {} of token {:4}",
            ctx.accounts.user.key(),
            next_event.buy_quantity,
            &event_list.token_buy.to_string()[..4],
            opposite_user_key,
            next_event.sell_quantity,
            &event_list.token_sell.to_string()[..4],
        );
        msg!("available balance: user token income ledger: {}, user token outcome ledger: {}, opposite user token income ledger: {}, opposite user token outcome ledger: {}",
            user_token_income_ledger.available_balance,
            user_token_outcome_ledger.available_balance,
            opposite_user_token_income_ledger.available_balance,
            opposite_user_token_outcome_ledger.available_balance,
        );
        msg!("locked balance: user token income ledger: {}, user token outcome ledger: {}, opposite user token income ledger: {}, opposite user token outcome ledger: {}",
            user_token_income_ledger.locked_balance,
            user_token_outcome_ledger.locked_balance,
            opposite_user_token_income_ledger.locked_balance,
            opposite_user_token_outcome_ledger.locked_balance,
        );
        msg!("mint account: user token income ledger: {}, user token outcome ledger: {}, \nopposite user token income ledger: {}, opposite user token outcome ledger: {}",
            user_token_income_ledger.mint_account,
            user_token_outcome_ledger.mint_account,
            opposite_user_token_income_ledger.mint_account,
            opposite_user_token_outcome_ledger.mint_account,
        );
        user_token_outcome_ledger.locked_balance -= next_event.sell_quantity;
        opposite_user_token_outcome_ledger.locked_balance -= next_event.buy_quantity;
        user_token_income_ledger.available_balance += next_event.buy_quantity;
        opposite_user_token_income_ledger.available_balance += next_event.sell_quantity;

        // todo: emit filled event
        msg!("Event: User {} bought {} of token {} from user {} for {} of token {}",
            ctx.accounts.user.key(),
            next_event.buy_quantity,
            event_list.token_buy,
            opposite_user_key,
            next_event.sell_quantity,
            event_list.token_sell,
        );
    }
    msg!("length: {}", event_list.length());

    // todo: emit event
    if event_list.length() == 0 {
        event_list.close();
        msg!("Event list closed after consuming events.");
    } else {
        msg!("Event list still has events, not closing.");
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