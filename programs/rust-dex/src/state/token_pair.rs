use anchor_lang::prelude::*;
use crate::state::{OrderHeap};

pub const TOKEN_PAIR_SEED: &[u8] = b"token_pair";

#[account(zero_copy)]
pub struct TokenPairAccount {
    pub buy_token: Pubkey,
    pub sell_token: Pubkey,
    pub order_heap: OrderHeap,
    pub bump: u8,
    pub pad: [u8; 7], // Padding to make the size 64 
}