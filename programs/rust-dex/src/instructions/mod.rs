use anchor_lang::prelude::*;

/// Instruction context for initializing a market
#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = payer,
        space = crate::state::Market::LEN,
        seeds = [
            b"market",
            base_mint.key().as_ref(),
            quote_mint.key().as_ref()
        ],
        bump
    )]
    pub market: Account<'info, crate::state::Market>,
    
    /// Base token mint
    pub base_mint: Account<'info, anchor_spl::token::Mint>,
    
    /// Quote token mint
    pub quote_mint: Account<'info, anchor_spl::token::Mint>,
    
    /// Base token vault
    #[account(mut)]
    pub base_vault: Account<'info, anchor_spl::token::TokenAccount>,
    
    /// Quote token vault
    #[account(mut)]
    pub quote_vault: Account<'info, anchor_spl::token::TokenAccount>,
    
    /// Market authority (usually the program)
    pub market_authority: Signer<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

/// Instruction context for initializing an orderbook
#[derive(Accounts)]
pub struct InitializeOrderBook<'info> {
    #[account(
        init,
        payer = payer,
        space = crate::state::OrderBook::LEN,
        seeds = [
            b"orderbook",
            market.key().as_ref()
        ],
        bump
    )]
    pub orderbook: Account<'info, crate::state::OrderBook>,
    
    #[account(mut)]
    pub market: Account<'info, crate::state::Market>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

/// Instruction context for placing orders
#[derive(Accounts)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub market: Account<'info, crate::state::Market>,
    
    #[account(
        mut,
        seeds = [
            b"orderbook",
            market.key().as_ref()
        ],
        bump = orderbook.bump
    )]
    pub orderbook: Account<'info, crate::state::OrderBook>,
    
    #[account(
        init,
        payer = user,
        space = crate::state::OrderAccount::LEN,
        seeds = [
            b"order",
            orderbook.key().as_ref(),
            orderbook.next_order_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub order_account: Account<'info, crate::state::OrderAccount>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

/// Instruction context for cancelling orders
#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub market: Account<'info, crate::state::Market>,
    
    #[account(
        mut,
        seeds = [
            b"orderbook",
            market.key().as_ref()
        ],
        bump = orderbook.bump
    )]
    pub orderbook: Account<'info, crate::state::OrderBook>,
    
    #[account(
        mut,
        close = user,
        constraint = order_account.order.owner == user.key()
    )]
    pub order_account: Account<'info, crate::state::OrderAccount>,
    
    #[account(mut)]
    pub user: Signer<'info>,
}
