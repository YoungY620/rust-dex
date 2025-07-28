use anchor_lang::prelude::*;
use crate::common::MAX_EVENTS;
use crate::common::ErrorCode;

#[account]
#[derive(Default, Debug)]
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

impl EventList {
    pub fn close(&mut self) {
        self.length = 0;
        self.in_use = 0;
    }

    pub fn open(&mut self, token_buy: Pubkey, token_sell: Pubkey, order_id: u64) {
        self.token_buy = token_buy;
        self.token_sell = token_sell;
        self.order_id = order_id;
        self.length = 0;
        self.in_use = 1; // Mark as in use
    }
    
    pub fn add_event(&mut self, user: Pubkey, buy_quantity: u64, sell_quantity: u64) -> Result<()> {
        if self.length as usize >= MAX_EVENTS {
            return Err(ErrorCode::EventListFull.into());
        }
        let idx = self.length as usize;
        self.user[idx] = user;
        self.buy_quantity[idx] = buy_quantity;
        self.sell_quantity[idx] = sell_quantity;
        self.length += 1;
        Ok(())
    }

    pub fn length(&self) -> u64 {
        self.length
    }
    pub fn is_full(&self) -> bool {
        self.length as usize >= MAX_EVENTS
    }
    
}
