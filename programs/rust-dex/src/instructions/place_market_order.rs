use anchor_lang::prelude::*;
use crate::{
    common::{ErrorCode, OrderRequest, OrderType}, 
    matching_engine::MatchingEngine, 
    state::{OrderHeap, EventList, IndividualTokenLedgerAccount, TokenPairAccount}, 
    DexManager,
};
use crate::instructions::common::token_pair_queue_logging;
use crate::instructions::common::convert_to_event_list;

pub fn place_market_order_impl(ctx: Context<PlaceMarketOrder>, base: Pubkey, quote: Pubkey, side: String, amount: u64) -> Result<()> {
    msg!("Placing market order: {} for amount {}", side, amount);
    if side != "buy" && side != "sell" {
        return Err(ErrorCode::InvalidOrderSide.into());
    }
    
    let token_buy: Pubkey = if side == "buy" { base } else { quote };
    let token_sell: Pubkey = if side == "sell" { base } else { quote };
    
    // 锁定用户要卖出的token余额
    let selling_token_ledger = if side == "sell" {
        &mut ctx.accounts.user_base_token_ledger
    } else {
        &mut ctx.accounts.user_quote_token_ledger
    };
    let available_balance = selling_token_ledger.available_balance;
    
    // 市价单设置：卖单时卖量为amount买量为0，买单时买量为amount卖量为全部可用余额
    let (buy_amount, sell_amount) = match side.as_str() {
        "buy" => (amount, available_balance),
        "sell" => (0, amount),
        _ => unreachable!(),
    };
    
    msg!("Market order details: buy_amount={}, sell_amount={}, available_balance={}, owner={}", 
        buy_amount, sell_amount, available_balance, ctx.accounts.user.key());
    
    // 检查余额是否充足
    if selling_token_ledger.available_balance < sell_amount {
        return Err(ErrorCode::InsufficientBalance.into());
    }
    
    // 对于市价买单，如果可用余额为0，直接返回错误
    if side == "buy" && available_balance == 0 {
        return Err(ErrorCode::InsufficientBalance.into());
    }
    
    selling_token_ledger.available_balance -= sell_amount;
    selling_token_ledger.locked_balance += sell_amount;

    // 获取订单簿账户
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
        let buy_queue: &mut OrderHeap = &mut buy_queue_account.order_heap;
        let sell_queue: &mut OrderHeap = &mut sell_queue_account.order_heap;
        token_pair_queue_logging(buy_queue, sell_queue);
    }
    
    let buy_queue: &mut OrderHeap = &mut buy_queue_account.order_heap;
    let sell_queue: &mut OrderHeap = &mut sell_queue_account.order_heap;
    let event_list: &mut EventList = &mut ctx.accounts.order_events;
    
    // 初始化事件列表
    event_list.in_use = 1;
    event_list.length = 0;
    event_list.token_buy = token_buy;
    event_list.token_sell = token_sell;
    let next_order_id = ctx.accounts.dex_manager.next_sequence_number();
    event_list.order_id = next_order_id;
    
    // 创建市价单请求
    let order_request = OrderRequest::new(
        next_order_id,
        buy_amount,
        sell_amount,
        token_buy,
        token_sell,
        ctx.accounts.user.key(),
        Clock::get()?.unix_timestamp,
        OrderType::Market,  // 使用市价单类型
    );
    
    msg!("Market Order Request: {:?}", order_request);
    
    // 处理订单
    let mut order_book = MatchingEngine::new(
        token_buy,
        token_sell,
        buy_queue,
        sell_queue,
    );
    
    let result = order_book.process_order(order_request);
    msg!("Market Order Process Result: {:?}", result);
    
    // 转换结果到事件列表
    convert_to_event_list(event_list, result);
    // token_pair_queue_logging(buy_queue, sell_queue);

    Ok(())
}


#[derive(Accounts)]
#[instruction(base: Pubkey, quote: Pubkey)]
pub struct PlaceMarketOrder<'info> {
    #[account(mut, seeds = [b"token_pair", base.as_ref(), quote.as_ref()], bump)]
    pub base_quote_queue: AccountLoader<'info, TokenPairAccount>,
    
    #[account(mut, seeds = [b"token_pair", quote.as_ref(), base.as_ref()], bump)]
    pub quote_base_queue: AccountLoader<'info, TokenPairAccount>,
    
    #[account(mut, seeds = [b"dex_manager"], bump)]
    pub dex_manager: Account<'info, DexManager>,
    
    #[account(mut, seeds = [b"order_events", user.key().as_ref()], bump = order_events.bump)]
    pub order_events: Box<Account<'info, EventList>>,
    
    #[account(mut, seeds = [b"individual_token_ledger", base.as_ref(), user.key().as_ref()], bump)]
    pub user_base_token_ledger: Box<Account<'info, IndividualTokenLedgerAccount>>,
    
    #[account(mut, seeds = [b"individual_token_ledger", quote.as_ref(), user.key().as_ref()], bump)]
    pub user_quote_token_ledger: Box<Account<'info, IndividualTokenLedgerAccount>>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}