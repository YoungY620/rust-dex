use anchor_lang::prelude::*;
use crate::common::MAX_EVENTS;

#[account]
pub struct EventList {
    pub user: [Pubkey; MAX_EVENTS],
    pub buy_quantity: [u64; MAX_EVENTS],
    pub sell_quantity: [u64; MAX_EVENTS],
    pub token_buy: Pubkey,
    pub token_sell: Pubkey,
    pub order_id: u64,
    pub length: u64,
    pub in_use: u8,
    pub bump: u8,
}
