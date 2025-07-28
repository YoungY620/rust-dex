use anchor_lang::prelude::*;
use crate::state::{OrderHeap};
use crate::common::{ErrorCode};

#[account(zero_copy)]
pub struct TokenPairAccount {
    pub buy_token: Pubkey,
    pub sell_token: Pubkey,
    pub order_heap: OrderHeap,
    pub bump: u8,
    pub pad: [u8; 7], // Padding to make the size 64 
}