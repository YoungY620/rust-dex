use anchor_lang::prelude::*;
use crate::common::MAX_EVENTS;
use crate::common::ErrorCode;

pub const ORDER_EVENTS_SEED: &[u8] = b"order_events";

#[derive(Debug)]
pub struct Event {
    pub oppo_user: Pubkey,
    pub buy_quantity: u64,
    pub sell_quantity: u64,
    pub rollback: bool,
    pub oppo_order_id: u64,
    pub filled: bool,
    pub oppo_filled: bool,
}

#[account]
#[derive(Default, Debug)]
pub struct EventList {
    pub oppo_user: [Pubkey; MAX_EVENTS],
    pub buy_quantity: [u64; MAX_EVENTS],
    pub sell_quantity: [u64; MAX_EVENTS],
    pub rollback: [u8; MAX_EVENTS],
    pub oppo_order_id: [u64; MAX_EVENTS],
    pub filled: [u8; MAX_EVENTS],
    pub oppo_filled: [u8; MAX_EVENTS],
    pub user: Pubkey,
    pub token_buy: Pubkey,
    pub token_sell: Pubkey,
    pub order_id: u64,
    pub length: u64,
    pub in_use: u8,
    pub bump: u8,
}

impl EventList {
    pub fn init(&mut self, user: Pubkey, token_buy: Pubkey, token_sell: Pubkey, order_id: u64) {
        self.user = user;
        self.token_buy = token_buy;
        self.token_sell = token_sell;
        self.order_id = order_id;
        msg!("length = 0 in init");
        self.length = 0;
        self.in_use = 0; // Mark as not in use
        self.oppo_user = [Pubkey::default(); MAX_EVENTS];
        self.buy_quantity = [0; MAX_EVENTS];
        self.sell_quantity = [0; MAX_EVENTS];
        self.rollback = [0; MAX_EVENTS];
        self.oppo_order_id = [0; MAX_EVENTS];
        self.filled = [0; MAX_EVENTS];
        self.oppo_filled = [0; MAX_EVENTS];
    }

    pub fn close(&mut self) {
        msg!("length = 0 in close");
        self.length = 0;
        self.in_use = 0;
    }

    pub fn is_closed(&self) -> bool {
        self.in_use == 0
    }

    pub fn open(&mut self, user: Pubkey, token_buy: Pubkey, token_sell: Pubkey, order_id: u64) -> Result<()> {
        if self.in_use != 0 {
            return Err(ErrorCode::EventListAlreadyInUse.into());
        }
        self.user = user;
        self.token_buy = token_buy;
        self.token_sell = token_sell;
        self.order_id = order_id;
        msg!("length = 0 in open");
        self.length = 0;
        self.in_use = 1; // Mark as in use
        Ok(())
    }

    pub fn add_event(&mut self, 
        oppo_user: Pubkey, 
        buy_quantity: u64, 
        sell_quantity: u64, 
        rollback: u8, 
        oppo_order_id: u64,
        oppo_filled: u8,
        filled: u8,

    ) -> Result<()> {
        if self.length as usize >= MAX_EVENTS {
            return Err(ErrorCode::EventListFull.into());
        }
        let idx = self.length as usize;
        self.oppo_user[idx] = oppo_user;
        self.buy_quantity[idx] = buy_quantity;
        self.sell_quantity[idx] = sell_quantity;
        self.rollback[idx] = rollback;
        self.filled[idx] = filled;
        self.oppo_filled[idx] = oppo_filled;
        self.oppo_order_id[idx] = oppo_order_id;
        self.length += 1;
        msg!("length = {} in add_event", self.length);
        Ok(())
    }

    pub fn length(&self) -> u64 {
        self.length
    }
    pub fn is_full(&self) -> bool {
        self.length as usize >= MAX_EVENTS
    }

    pub fn at(&self, index: usize) -> Option<(Pubkey, u64, u64)> {
        if index >= self.length as usize {
            return None;
        }
        Some((self.oppo_user[index], self.buy_quantity[index], self.sell_quantity[index]))
    }
    
    pub fn pop(&mut self) -> Option<Event> {
        if self.length == 0 {
            return None;
        }
        let idx = (self.length - 1) as usize;
        self.length -= 1;
        msg!("length = {} in pop", self.length);
        
        Some(Event {
            oppo_user: self.oppo_user[idx],
            buy_quantity: self.buy_quantity[idx],
            sell_quantity: self.sell_quantity[idx],
            rollback: self.rollback[idx] == 1,
            oppo_order_id: self.oppo_order_id[idx],
            filled: self.filled[idx] == 1,
            oppo_filled: self.oppo_filled[idx] == 1,
        })
    }
}
