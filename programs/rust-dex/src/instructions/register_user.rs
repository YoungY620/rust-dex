use anchor_lang::prelude::*;
use crate::common::MAX_EVENTS;
use crate::common::MAX_TOKEN_MINTS;
use crate::state::EventList;
use crate::state::IndividualLedgerAccount;
use crate::state::UserOrderbook;
use crate::state::ORDER_EVENTS_SEED;
use crate::state::INDIVIDUAL_LEDGER_SEED;
use crate::state::USER_ORDERBOOK_SEED;

pub fn register_user_impl(ctx: Context<RegisterUser>) -> Result<()> {
    msg!("Registering user with key: {:?}", ctx.accounts.user.key());
    let individual_ledger: &mut IndividualLedgerAccount = &mut ctx.accounts.individual_ledger;
    let user_order_book: &mut UserOrderbook = &mut ctx.accounts.user_order_book;
    let user_events: &mut EventList = &mut ctx.accounts.order_events;

    // Initialize individual_ledger
    individual_ledger.next_index = 0;
    individual_ledger.bump = ctx.bumps.individual_ledger;
    for i in 0..MAX_TOKEN_MINTS {
        individual_ledger.tokens[i] = Pubkey::default();
        individual_ledger.bitmap[i] = 0;
    }

    // Initialize user_order_book
    user_order_book.next_index = 0;
    user_order_book.bump = ctx.bumps.user_order_book;
    for i in 0..MAX_TOKEN_MINTS {
        user_order_book.orders[i] = 0;
        user_order_book.bitmap[i] = 0;
    }

    // Initialize user_events
    user_events.token_buy = Pubkey::default();
    user_events.token_sell = Pubkey::default();
    user_events.order_id = 0;
    user_events.length = 0;
    user_events.in_use = 0;
    user_events.bump = ctx.bumps.order_events;
    for i in 0..MAX_EVENTS {
        user_events.oppo_user[i] = Pubkey::default();
        user_events.buy_quantity[i] = 0;
        user_events.sell_quantity[i] = 0;
    }
    
    Ok(())
}



#[derive(Accounts)]
pub struct RegisterUser<'info> {
    #[account(
        init,
        payer = user,
        seeds = [INDIVIDUAL_LEDGER_SEED, user.key().as_ref()],
        bump,
        space = 8 + MAX_TOKEN_MINTS * 32 + MAX_TOKEN_MINTS + 2 + 1 // Adjust size based on IndividualLedgerAccount struct size
    )]
    pub individual_ledger: Box<Account<'info, IndividualLedgerAccount>>,
    #[account(
        init,
        payer = user,
        seeds = [USER_ORDERBOOK_SEED, user.key().as_ref()],
        bump,
        space = 8 + MAX_TOKEN_MINTS * 16 + MAX_TOKEN_MINTS + 2 + 1 // UserOrderbook: orders[16*32] + next_index[2] + bitmap[32] + bump[1]
    )]
    pub user_order_book: Box<Account<'info, UserOrderbook>>,
    #[account(
        init,
        payer = user,
        seeds = [ORDER_EVENTS_SEED, user.key().as_ref()],
        bump,
        space = 8 + (MAX_EVENTS * (32 + 8 + 8) + 32 + 32 + 8 + 8 + 1 + 1) // EventList: user[32*32] + buy_quantity[8*32] + sell_quantity[8*32] + token_buy[32] + token_sell[32] + order_id[8] + length[8] + pad[6] + in_use[1] + bump[1]
    )]
    pub order_events: Box<Account<'info, EventList>>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}