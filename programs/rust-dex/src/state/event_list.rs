use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::confidential_mint_burn::instruction::RotateSupplyElGamalPubkeyData;
use crate::common::MAX_EVENTS;
use crate::common::ErrorCode;

pub const ORDER_EVENTS_SEED: &[u8] = b"order_events";

#[account]
#[derive(Default, Debug)]
pub struct EventList {
    pub oppo_user: [Pubkey; MAX_EVENTS],
    pub buy_quantity: [u64; MAX_EVENTS],
    pub sell_quantity: [u64; MAX_EVENTS],
    pub rollback: [u8; MAX_EVENTS], // Used to track if an event has been rolled back
    pub oppo_order_id: [u64; MAX_EVENTS], // Used to track the order ID of the opposite user
    pub filled: [u8; MAX_EVENTS], // Used to track if the event has been filled
    pub oppo_filled: [u8; MAX_EVENTS], // Used to track if the opposite user has filled the event
    pub user: Pubkey, // The user who created this event list
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
        self.length += 1;
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
    
    pub fn pop(&mut self) -> Option<(Pubkey, u64, u64)> {
        if self.length == 0 {
            return None;
        }
        self.length -= 1;
        Some((self.oppo_user[self.length as usize], self.buy_quantity[self.length as usize], self.sell_quantity[self.length as usize]))
    }
}
