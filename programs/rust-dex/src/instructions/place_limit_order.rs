use anchor_lang::prelude::*;
use crate::{common::{ErrorCode, OrderRequest, OrderType}, 
    instructions::{IndividualTokenLedgerAccount, TokenPairAccount}, 
    orderbook::{OrderBook, OrderSuccess}, 
    state::{OrderHeap, EventList}, DexManager};

pub fn place_limit_order_impl(ctx: Context<PlaceLimitOrder>, base: Pubkey, quote: Pubkey, side: String, price: f64, amount: u64) -> Result<()> {
    msg!("Placing limit order: {} for amount {}", side, amount);
    if side != "buy" && side != "sell" {
        return Err(ErrorCode::InvalidOrderSide.into());
    }
    
    // All inputs are in minimum units:
    // - amount: in base token minimum units (e.g., lamports for SOL)
    // - price: exchange rate between minimum units (quote_units per base_unit)
    // For buy: need to pay (amount * price) quote tokens
    // For sell: will receive (amount * price) quote tokens
    
    let buy_amount = if side == "buy" { 
        amount 
    } else { 
        // For sell orders, amount is what we're selling (base tokens)
        // We'll receive (amount * price) quote tokens
        (amount as f64 * price) as u64
    };
    
    let sell_amount = if side == "sell" { 
        amount 
    } else { 
        // For buy orders, amount is what we want to buy (base tokens)
        // We need to pay (amount * price) quote tokens
        (amount as f64 * price) as u64
    };
    
    let token_buy = if side == "buy" { base } else { quote };
    let token_sell = if side == "sell" { base } else { quote };
    
    msg!("Order details: buy_amount={}, sell_amount={}, price={}", buy_amount, sell_amount, price);
    
    let selling_token_ledger = if side == "sell" {
        &mut ctx.accounts.user_base_token_ledger
    } else {
        &mut ctx.accounts.user_quote_token_ledger
    };
    if selling_token_ledger.available_balance < sell_amount {
        return Err(ErrorCode::InsufficientBalance.into());
    }
    selling_token_ledger.available_balance -= sell_amount;
    selling_token_ledger.locked_balance += sell_amount;

    let mut buy_queue_account = ctx.accounts.buy_base_queue.load_mut()?;
    let mut sell_queue_account = ctx.accounts.sell_base_queue.load_mut()?;
    let buy_queue: &mut OrderHeap = &mut buy_queue_account.order_heap;
    let sell_queue: &mut OrderHeap = &mut sell_queue_account.order_heap;
    let event_list: &mut EventList = &mut ctx.accounts.order_events;
    event_list.in_use = 1; // Reset in-use events count
    event_list.length = 0; // Reset length of events
    event_list.token_buy = token_buy;
    event_list.token_sell = token_sell;
    let next_order_id = ctx.accounts.dex_manager.next_sequence_number();
    event_list.order_id = next_order_id;
    
    let order_request = OrderRequest::new(
        next_order_id,
        buy_amount,
        sell_amount,
        token_buy,
        token_sell,
        ctx.accounts.user.key(),
        Clock::get()?.unix_timestamp,
        OrderType::Limit,
    );
    msg!("Order Request: {:?}", order_request);
    let mut order_book = OrderBook::new(
        token_buy,
        token_sell,
        buy_queue,
        sell_queue,
    );
    
    let result = order_book.process_order(order_request);
    for res in result {
        match res {
            Ok(success) => {
                match success {
                    OrderSuccess::Filled {
                        order_id: _,
                        order_type: _,
                        sell_quantity: buy_quantity,
                        buy_quantity: sell_quantity,
                        block_time: _
                    } => {
                        let idx = event_list.length as usize;
                        event_list.user[idx] = ctx.accounts.user.key();
                        event_list.buy_quantity[idx] = buy_quantity;
                        event_list.sell_quantity[idx] = sell_quantity;
                        
                        event_list.length += 1;
                    },
                    OrderSuccess::PartialFilled {
                        order_id: _,
                        order_type: _,
                        sell_quantity: buy_quantity,
                        buy_quantity: sell_quantity,
                        block_time: _
                    } => {
                        let idx = event_list.length as usize;
                        event_list.user[idx] = ctx.accounts.user.key();
                        event_list.buy_quantity[idx] = buy_quantity;
                        event_list.sell_quantity[idx] = sell_quantity;
                        
                        event_list.length += 1;
                    },
                    _ => {
                        msg!("Order Success: {:?}", success);
                    }
                }
            },
            Err(failure) => {
                msg!("Order Failed: {:?}", failure);
            }
        }
    }


    Ok(())
}

#[derive(Accounts)]
#[instruction(base: Pubkey, quote: Pubkey)]
pub struct PlaceLimitOrder<'info> {
    #[account(
        mut,
        seeds = [b"token_pair", base.as_ref(), quote.as_ref()],
        bump,
    )]
    pub buy_base_queue: AccountLoader<'info, TokenPairAccount>,
    #[account(
        mut,
        seeds = [b"token_pair", quote.as_ref(), base.as_ref()],
        bump,
    )]
    pub sell_base_queue: AccountLoader<'info, TokenPairAccount>,
    #[account(
        mut,
        seeds = [b"dex_manager"],
        bump,
    )]
    pub dex_manager: Account<'info, DexManager>,
    #[account(
        mut,
        seeds = [b"order_events", user.key().as_ref()],
        bump,
        // space = 8 + (MAX_EVENTS * (32 + 8 + 8) + 32 + 32 + 8 + 8) // Adjust size based on EventList struct size
    )]
    pub order_events: Box<Account<'info, EventList>>,
    #[account(mut)]
    pub user_base_token_ledger: Box<Account<'info, IndividualTokenLedgerAccount>>,
    #[account(mut)]
    pub user_quote_token_ledger: Box<Account<'info, IndividualTokenLedgerAccount>>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}