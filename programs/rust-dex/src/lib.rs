use anchor_lang::prelude::*;
use std::collections::BTreeMap;

mod orderbook;
mod orderqueue;
mod order;

declare_id!("DxDE9zuCpkBiuJhAYo5een6xMqF34J3jZuRYCodLhVnw");

#[account]
#[derive(Debug)]
pub struct State {
    pub orderbooks: BTreeMap<String, orderbook::OrderBook>
}

#[program]
pub mod rust_dex {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, token_address: Pubkey, amount: u64) -> Result<()> {
        msg!("Deposit amount: {}", amount);
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, token_address: Pubkey, amount: u64) -> Result<()> {
        msg!("Withdraw amount: {}", amount);
        Ok(())
    }

    pub fn place_limit_order(ctx: Context<PlaceLimitOrder>, token_pair: (Pubkey, Pubkey), side: String, price: u64, amount: u64) -> Result<()> {
        msg!("Placing limit order: {} {} at price {}", side, amount, price);
        
        Ok(())
    }
    pub fn place_market_order(ctx: Context<PlaceMarketOrder>, token_pair: (Pubkey, Pubkey), side: String, amount: u64) -> Result<()> {
        msg!("Placing market order: {} for amount {}", side, amount);
        
        Ok(())
    }
    pub fn cancel_order(ctx: Context<CancelOrder>, order_id: u128) -> Result<()> {
        msg!("Cancelling order with ID: {}", order_id);
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
