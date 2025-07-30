use anchor_lang::prelude::*;
use crate::state::{OrderHeapImpl};
use crate::common::{ErrorCode};
use crate::TokenPairAccount;
// pub const ORDER_HEAP_CAPACITY: usize = 1024; // Capacity of the order heap
use crate::state::TOKEN_PAIR_SEED;


pub fn register_token_pair_impl(ctx: Context<RegisterTokenPair>, token1: Pubkey, token2: Pubkey) -> Result<()> {
    msg!("Registering token pair with base: {:?} and quote: {:?}", token1, token2);

    if token1 == token2 {
        return Err(ErrorCode::InvalidTokenPair.into());
    }

    let token_pair = &mut ctx.accounts.token_pair.load_init()?;
    token_pair.buy_token = token1;
    token_pair.sell_token = token2;
    token_pair.order_heap = OrderHeapImpl::new(); // Initialize the order heap

    let opposite_pair = &mut ctx.accounts.opposite_pair.load_init()?;
    opposite_pair.buy_token = token2;
    opposite_pair.sell_token = token1;
    opposite_pair.order_heap = OrderHeapImpl::new();

    Ok(())
}

#[derive(Accounts)]
#[instruction(token1: Pubkey, token2: Pubkey)]
pub struct RegisterTokenPair<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        init,
        payer = user,
        seeds = [TOKEN_PAIR_SEED, token1.as_ref(), token2.as_ref()],
        bump,
        space = 10 * (1024 as usize) // Adjust size based on TokenPairAccount struct size
        // space = 8 + 32 + 32 + 8 + ((104 + 1) * ORDER_HEAP_CAPACITY + 8) // Adjust size based on TokenPairAccount struct size
    )]
    pub token_pair: AccountLoader<'info, TokenPairAccount>,
    #[account(
        init,
        payer = user,
        seeds = [TOKEN_PAIR_SEED, token2.as_ref(), token1.as_ref()],
        bump,
        space = 10 * (1024 as usize) // Adjust size based on TokenPairAccount struct size
        // space = 8 + 32 + 32 + 8 + ((104 + 1) * ORDER_HEAP_CAPACITY + 8) // Adjust size based on TokenPairAccount struct size
    )]
    pub opposite_pair: AccountLoader<'info, TokenPairAccount>,
}