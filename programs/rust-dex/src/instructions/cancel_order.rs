use anchor_lang::prelude::*;

use crate::{TokenPairAccount, UserOrderbook, USER_ORDERBOOK_SEED};


pub fn cancel_order_impl(ctx: Context<CancelOrder>, order_id: u64) -> Result<()> {
    let mut base_quote_queue = ctx.accounts.base_quote_queue.load_mut().unwrap();
    if let Ok(node) = base_quote_queue.order_heap.remove_order(order_id){
        let user_orderbook = &mut ctx.accounts.user_order_book;
        user_orderbook.remove_order(order_id as u128)?;
        // todo: emit event
        msg!("Order with ID {:?} cancelled successfully", node);
    }

    Ok(())
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(
        mut,
        seeds = [USER_ORDERBOOK_SEED, user.key().as_ref()],
        bump = user_order_book.bump,
    )]
    pub user_order_book: Box<Account<'info, UserOrderbook>>,
    
    #[account(mut)]
    pub base_quote_queue: AccountLoader<'info, TokenPairAccount>,
    
    #[account(mut)]
    pub user: Signer<'info>,
}