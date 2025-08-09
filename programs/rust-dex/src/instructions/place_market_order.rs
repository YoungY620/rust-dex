use anchor_lang::prelude::*;
use crate::{
    common::{OrderRequest, OrderSide, OrderType}, 
    matching_engine::MatchingEngine, 
    state::{EventList, IndividualTokenLedgerAccount, OrderHeapImpl, TokenPairAccount}, 
    DexManager, UserOrderbook
};
use crate::instructions::common::token_pair_queue_logging;
use crate::instructions::common::convert_to_event_list;
use crate::state::ORDER_EVENTS_SEED;
use crate::state::DEX_MANAGER_SEED;
use crate::state::INDIVIDUAL_TOKEN_LEDGER_SEED;
use crate::state::TOKEN_PAIR_SEED;


#[error_code]
pub enum ErrorCode {
    InvalidOrderSide,
    InsufficientBalance,
}

pub fn place_market_order_impl(ctx: Context<PlaceMarketOrder>, base: Pubkey, quote: Pubkey, side: String, amount: u64) -> Result<()> {
    msg!("Placing market order: {} for amount {}", side, amount);
    if side != "buy" && side != "sell" {
        return Err(ErrorCode::InvalidOrderSide.into());
    }
    
    let token_buy: Pubkey = if side == "buy" { base } else { quote };
    let token_sell: Pubkey = if side == "sell" { base } else { quote };
    
    let selling_token_ledger = if side == "sell" {
        &mut ctx.accounts.user_base_token_ledger
    } else {
        &mut ctx.accounts.user_quote_token_ledger
    };
    let available_balance = selling_token_ledger.available_balance;
    
    let (buy_amount, sell_amount) = match side.as_str() {
        "buy" => (amount, available_balance),
        "sell" => (0, amount),
        _ => unreachable!(),
    };
        
    let mut buy_queue_account = if side == "buy" {
        ctx.accounts.base_quote_queue.load_mut()?
    } else {
        ctx.accounts.quote_base_queue.load_mut()?
    };
    
    let mut sell_queue_account = if side == "sell" {
        ctx.accounts.base_quote_queue.load_mut()?
    } else {
        ctx.accounts.quote_base_queue.load_mut()?
    };
    // 记录订单簿当前状态（调试用）
    {
        let buy_queue: &mut OrderHeapImpl = &mut buy_queue_account.order_heap;
        let sell_queue: &mut OrderHeapImpl = &mut sell_queue_account.order_heap;
        token_pair_queue_logging(buy_queue, sell_queue);
    }
    let buy_queue: &mut OrderHeapImpl = &mut buy_queue_account.order_heap;
    let sell_queue: &mut OrderHeapImpl = &mut sell_queue_account.order_heap;
    
    // balance check
    if selling_token_ledger.available_balance < sell_amount {
        return Err(ErrorCode::InsufficientBalance.into());
    }
    if side == "buy" && available_balance == 0 {
        return Err(ErrorCode::InsufficientBalance.into());
    }
    // event_list
    let event_list: &mut EventList = &mut ctx.accounts.order_events;
    let next_order_id = ctx.accounts.dex_manager.next_sequence_number();
    event_list.order_id = next_order_id;
    if let Err(error) = event_list.open(ctx.accounts.user.key(), base, quote, next_order_id) {
        return Err(error);
    }
    
    selling_token_ledger.available_balance -= sell_amount;
    selling_token_ledger.locked_balance += sell_amount;
    
    let order_request = OrderRequest::new(
        next_order_id,
        buy_amount,
        sell_amount,
        token_buy,
        token_sell,
        ctx.accounts.user.key(),
        Clock::get()?.unix_timestamp,
        OrderType::Market,  // 使用市价单类型
        if side == "buy" { OrderSide::Buy } else { OrderSide::Sell }
    );
    
    
    // 处理订单
    let user_orderbook: &mut UserOrderbook = &mut ctx.accounts.user_orderbook;
    let mut order_book = MatchingEngine::new(
        token_buy,
        token_sell,
        buy_queue,
        sell_queue,
        user_orderbook,
    );
    
    let result = order_book.process_order(order_request);
    
    // 转换结果到事件列表
    convert_to_event_list(event_list, result);
    // token_pair_queue_logging(buy_queue, sell_queue);
    if event_list.length() == 0 {
        event_list.close();
    } 

    Ok(())
}


#[derive(Accounts)]
#[instruction(base: Pubkey, quote: Pubkey)]
pub struct PlaceMarketOrder<'info> {
    #[account(mut, seeds = [TOKEN_PAIR_SEED, base.as_ref(), quote.as_ref()], bump)]
    pub base_quote_queue: AccountLoader<'info, TokenPairAccount>,
    
    #[account(mut, seeds = [TOKEN_PAIR_SEED, quote.as_ref(), base.as_ref()], bump)]
    pub quote_base_queue: AccountLoader<'info, TokenPairAccount>,
    
    #[account(mut, seeds = [DEX_MANAGER_SEED], bump)]
    pub dex_manager: Account<'info, DexManager>,
    
    #[account(mut, seeds = [ORDER_EVENTS_SEED, user.key().as_ref()], bump = order_events.bump)]
    pub order_events: Box<Account<'info, EventList>>,
    
    #[account(mut, seeds = [INDIVIDUAL_TOKEN_LEDGER_SEED, base.as_ref(), user.key().as_ref()], bump)]
    pub user_base_token_ledger: Box<Account<'info, IndividualTokenLedgerAccount>>,
    
    #[account(mut, seeds = [INDIVIDUAL_TOKEN_LEDGER_SEED, quote.as_ref(), user.key().as_ref()], bump)]
    pub user_quote_token_ledger: Box<Account<'info, IndividualTokenLedgerAccount>>,
    
    #[account(mut)]
    pub user_orderbook: Box<Account<'info, UserOrderbook>>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}