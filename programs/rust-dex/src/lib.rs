use anchor_lang::prelude::*;
use crate::instructions::*;
pub use crate::state::*;

mod matching_engine;
// mod orderqueue;
// mod order;
mod instructions;
mod common;
mod state;

declare_id!("FbCipEZbUmmQt5C9AvcvyMewWt3PtkL5RCLB5McmY2AJ");

#[program]
pub mod rust_dex {

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        let dex_manager = &mut ctx.accounts.dex_manager;
        dex_manager.sequence_number = 0;
        dex_manager.bump = ctx.bumps.dex_manager;
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

    pub fn register_token_pair(ctx: Context<RegisterTokenPair>, token1: Pubkey, token2: Pubkey) -> Result<()> {
        instructions::register_token_pair_impl(ctx, token1, token2)
    }

    pub fn deposit(ctx: Context<Deposit>, _mint_account: Pubkey, amount: u64) -> Result<()> {
        instructions::deposit_impl(ctx, _mint_account, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, _mint_account: Pubkey, amount: u64) -> Result<()> {
        instructions::withdraw_impl(ctx, _mint_account, amount)
    }

    pub fn place_limit_order(ctx: Context<PlaceLimitOrder>, base: Pubkey, quote: Pubkey, side: String, price: f64, amount: u64) -> Result<()> {
        instructions::place_limit_order_impl(ctx, base, quote, side, price, amount)
    }
    pub fn place_market_order(ctx: Context<PlaceMarketOrder>, base: Pubkey, quote: Pubkey, side: String, amount: u64) -> Result<()> {
        instructions::place_market_order_impl(ctx, base, quote, side, amount)
    }

    pub fn consume_events(ctx: Context<ConsumeEvents>, opposite_user_key: Pubkey) -> Result<()> {
        instructions::consume_event_impl(ctx, opposite_user_key)
    }

    pub fn close_dex_manager(_ctx: Context<CloseDexManager>) -> Result<()> {
        msg!("Closing DEX manager account");
        Ok(())
    }

    pub fn cancel_order(ctx: Context<CancelOrder>, order_id: u64) -> Result<()> {
        instructions::cancel_order_impl(ctx, order_id)
    }
}



#[derive(Accounts)]
pub struct CloseDexManager<'info> {
    #[account(
        mut,
        seeds = [DEX_MANAGER_SEED],
        bump = dex_manager.bump,
        close = user
    )]
    pub dex_manager: Account<'info, DexManager>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init, 
        payer = user,
        seeds = [DEX_MANAGER_SEED], 
        bump,
        space = 8 + 8 + 1 // discriminator + sequence_number + bump
    )]
    pub dex_manager: Account<'info, DexManager>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}
