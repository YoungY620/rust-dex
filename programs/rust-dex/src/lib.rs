use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::instructions::*;

// mod orderbook;
// mod orderqueue;
mod order;
mod instructions;

declare_id!("FbCipEZbUmmQt5C9AvcvyMewWt3PtkL5RCLB5McmY2AJ");

#[program]
pub mod rust_dex {

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }

    pub fn register_vault_token_ledger(ctx: Context<RegisterVaultTokenLedger>) -> Result<()> {
        instructions::register_vault_token_ledger_impl(ctx)  
    }

    pub fn register_user_token_ledger(ctx: Context<RegisterUserTokenLedger>, mint_account: Pubkey) -> Result<()> {
        instructions::register_user_token_ledger_impl(ctx, mint_account)
    }

    pub fn register_user (ctx: Context<RegisterUser>) -> Result<()> {
        instructions::register_user_impl(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, _mint_account: Pubkey, amount: u64) -> Result<()> {
        instructions::deposit_impl(ctx, _mint_account, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, _mint_account: Pubkey, amount: u64) -> Result<()> {
        msg!("Withdraw amount: {}", amount);
        Ok(())
    }

    pub fn place_limit_order(ctx: Context<PlaceLimitOrder>, base: Pubkey, quote: Pubkey, side: String, price: u64, amount: u64) -> Result<()> {
        msg!("Placing limit order: {} {} at price {}", side, amount, price);
        
        Ok(())
    }
    pub fn place_market_order(ctx: Context<PlaceMarketOrder>, base: Pubkey, quote: Pubkey, side: String, amount: u64) -> Result<()> {
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


#[derive(Accounts)]
pub struct Withdraw {
    // Add required accounts here, e.g.:
    // #[account(mut)]
    // pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct PlaceLimitOrder {
    // Add required accounts here
}

#[derive(Accounts)]
pub struct PlaceMarketOrder {
    // Add required accounts here
}

#[derive(Accounts)]
pub struct CancelOrder {
    // Add required accounts here
}
