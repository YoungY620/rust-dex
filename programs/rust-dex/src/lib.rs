use anchor_spl::token::{self, Transfer, TokenAccount, Token};
use anchor_lang::prelude::*;

mod error;
mod state;
mod instructions;
mod utils;

use crate::error::ErrorCode as DexError;
use state::*;
use instructions::*;

declare_id!("DxDE9zuCpkBiuJhAYo5een6xMqF34J3jZuRYCodLhVnw");

#[program]
pub mod rust_dex {
    use super::*;

    /// Initialize a new market
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        base_lot_size: u64,
        quote_lot_size: u64,
        maker_fee: i64,
        taker_fee: i64,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        
        market.market_authority = ctx.accounts.market_authority.key();
        market.base_mint = ctx.accounts.base_mint.key();
        market.quote_mint = ctx.accounts.quote_mint.key();
        market.base_vault = ctx.accounts.base_vault.key();
        market.quote_vault = ctx.accounts.quote_vault.key();
        market.base_lot_size = base_lot_size;
        market.quote_lot_size = quote_lot_size;
        market.maker_fee = maker_fee;
        market.taker_fee = taker_fee;
        market.seq_num = 0;
        market.bump = ctx.bumps.market;
        
        msg!("Initialized market for {}/{}", market.base_mint, market.quote_mint);
        Ok(())
    }

    /// Initialize orderbook for a market
    pub fn initialize_orderbook(ctx: Context<InitializeOrderBook>) -> Result<()> {
        let orderbook = &mut ctx.accounts.orderbook;
        let market = &ctx.accounts.market;
        
        orderbook.base_mint = market.base_mint;
        orderbook.quote_mint = market.quote_mint;
        orderbook.market_authority = market.market_authority;
        orderbook.next_order_id = 1;
        orderbook.bump = ctx.bumps.orderbook;
        orderbook.is_initialized = true;
        
        msg!("Initialized orderbook for market: {}", market.key());
        Ok(())
    }

    /// Place a limit order
    pub fn place_limit_order(
        ctx: Context<PlaceOrder>,
        side: u8, // 0 = bid, 1 = ask
        price_lots: u64,
        max_base_lots: u64,
        client_order_id: u64,
    ) -> Result<()> {
        let orderbook = &mut ctx.accounts.orderbook;
        let order_account = &mut ctx.accounts.order_account;
        let user = &ctx.accounts.user;
        
        require!(side <= 1, DexError::InvalidOrderSide);
        require!(price_lots > 0, DexError::InvalidPrice);
        require!(max_base_lots > 0, DexError::InvalidAmount);
        
        let order_id = orderbook.generate_order_id();
        let order_side = if side == 0 { crate::state::orderbook::Side::Bid } else { crate::state::orderbook::Side::Ask };
        
        let order = crate::state::orderbook::Order {
            order_id,
            owner: user.key(),
            side: order_side,
            order_type: crate::state::orderbook::OrderType::Limit,
            price_lots,
            max_base_lots,
            remaining_base_lots: max_base_lots,
            client_order_id,
            timestamp: Clock::get()?.unix_timestamp as u64,
        };
        
        order_account.order = order;
        order_account.bump = ctx.bumps.order_account;
        
        msg!("Placed limit order {} for {} base lots at {} price", 
             order_id, max_base_lots, price_lots);
        
        Ok(())
    }

    /// Place a market order
    pub fn place_market_order(
        ctx: Context<PlaceOrder>,
        side: u8, // 0 = bid, 1 = ask
        max_base_lots: u64,
        client_order_id: u64,
    ) -> Result<()> {
        let orderbook = &mut ctx.accounts.orderbook;
        let order_account = &mut ctx.accounts.order_account;
        let user = &ctx.accounts.user;
        
        require!(side <= 1, DexError::InvalidOrderSide);
        require!(max_base_lots > 0, DexError::InvalidAmount);
        
        let order_id = orderbook.generate_order_id();
        let order_side = if side == 0 { crate::state::orderbook::Side::Bid } else { crate::state::orderbook::Side::Ask };
        
        let order = crate::state::orderbook::Order {
            order_id,
            owner: user.key(),
            side: order_side,
            order_type: crate::state::orderbook::OrderType::Market,
            price_lots: 0, // Market orders don't have a specific price
            max_base_lots,
            remaining_base_lots: max_base_lots,
            client_order_id,
            timestamp: Clock::get()?.unix_timestamp as u64,
        };
        
        order_account.order = order;
        order_account.bump = ctx.bumps.order_account;
        
        msg!("Placed market order {} for {} base lots", 
             order_id, max_base_lots);
        
        Ok(())
    }

    /// Cancel an order
    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        let order_account = &ctx.accounts.order_account;
        
        msg!("Cancelled order {}", order_account.order.order_id);
        
        // The order account will be closed automatically due to the close constraint
        Ok(())
    }

    /// Initialize user balance account
    pub fn initialize_user_balance(
        ctx: Context<InitializeUserBalance>,
        token_mint: Pubkey,
    ) -> Result<()> {
        let user_balance = &mut ctx.accounts.user_balance;
        
        user_balance.user = ctx.accounts.user.key();
        user_balance.token_mint = token_mint;
        user_balance.balance = 0;
        user_balance.bump = ctx.bumps.user_balance;
        
        msg!("Initialized user balance account for user: {} and token: {}", 
             ctx.accounts.user.key(), 
             token_mint);
        Ok(())
    }

    /// Initialize pool
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        token_mint: Pubkey,
    ) -> Result<()> {
        let pool_account = &mut ctx.accounts.pool;
        
        pool_account.token_mint = token_mint;
        pool_account.vault = ctx.accounts.vault.key();
        pool_account.total_deposited = 0;
        pool_account.bump = ctx.bumps.pool;
        pool_account.is_initialized = true;
        
        msg!("Initialized pool for token: {}", token_mint);
        Ok(())
    }

    /// Deposit tokens to pool
    pub fn deposit(ctx: Context<Deposit>, _token_address: Pubkey, amount: u64) -> Result<()> {
        require!(amount > 0, DexError::InvalidAmount);
        
        // Transfer tokens from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token::transfer(cpi_ctx, amount)?;

        // Update pool total
        ctx.accounts.pool.total_deposited = ctx.accounts.pool.total_deposited.checked_add(amount)
            .ok_or(DexError::Overflow)?;

        // Update user balance
        ctx.accounts.user_balance.balance = ctx.accounts.user_balance.balance.checked_add(amount)
            .ok_or(DexError::Overflow)?;

        msg!("User {} deposited {} tokens. New balance: {}, Pool total: {}", 
             ctx.accounts.user.key(),
             amount, 
             ctx.accounts.user_balance.balance,
             ctx.accounts.pool.total_deposited);
        
        Ok(())
    }

    /// Withdraw tokens from pool
    pub fn withdraw(ctx: Context<Withdraw>, _token_address: Pubkey, amount: u64) -> Result<()> {
        require!(amount > 0, DexError::InvalidAmount);
        require!(ctx.accounts.user_balance.balance >= amount, DexError::InsufficientBalance);
        
        let token_mint = ctx.accounts.pool.token_mint;
        let pool_bump = ctx.accounts.pool.bump;
        let user_key = ctx.accounts.user.key();
        
        // Update balances
        ctx.accounts.user_balance.balance = ctx.accounts.user_balance.balance.checked_sub(amount)
            .ok_or(DexError::Underflow)?;
        
        ctx.accounts.pool.total_deposited = ctx.accounts.pool.total_deposited.checked_sub(amount)
            .ok_or(DexError::Underflow)?;

        // Transfer tokens from vault to user using PDA authority
        let seeds = &[
            b"pool",
            token_mint.as_ref(),
            &[pool_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);

        token::transfer(cpi_ctx, amount)?;

        msg!("User {} withdrew {} tokens. New balance: {}, Pool total: {}", 
             user_key,
             amount, 
             ctx.accounts.user_balance.balance,
             ctx.accounts.pool.total_deposited);
        
        Ok(())
    }
}

// Pool account for tracking token pools
#[account]
#[derive(Debug)]
pub struct PoolAccount {
    pub token_mint: Pubkey,
    pub vault: Pubkey,
    pub total_deposited: u64,
    pub bump: u8,
    pub is_initialized: bool,
}

// User balance account
#[account]
#[derive(Debug)]
pub struct UserBalanceAccount {
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub balance: u64,
    pub bump: u8,
}

// Account contexts for pool operations
#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct InitializeUserBalance<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        init,
        payer = user,
        space = 8 + 32 + 32 + 8 + 1,
        seeds = [
            b"user_balance",
            user.key().as_ref(),
            token_mint.as_ref()
        ],
        bump
    )]
    pub user_balance: Account<'info, UserBalanceAccount>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 8 + 1 + 1,
        seeds = [
            b"pool",
            token_mint.as_ref()
        ],
        bump
    )]
    pub pool: Account<'info, PoolAccount>,
    
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [
            b"pool",
            pool.token_mint.as_ref()
        ],
        bump = pool.bump
    )]
    pub pool: Account<'info, PoolAccount>,
    
    #[account(
        mut,
        seeds = [
            b"user_balance",
            user.key().as_ref(),
            pool.token_mint.as_ref()
        ],
        bump = user_balance.bump
    )]
    pub user_balance: Account<'info, UserBalanceAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [
            b"pool",
            pool.token_mint.as_ref()
        ],
        bump = pool.bump
    )]
    pub pool: Account<'info, PoolAccount>,
    
    #[account(
        mut,
        seeds = [
            b"user_balance",
            user.key().as_ref(),
            pool.token_mint.as_ref()
        ],
        bump = user_balance.bump
    )]
    pub user_balance: Account<'info, UserBalanceAccount>,
    
    pub token_program: Program<'info, Token>,
}
