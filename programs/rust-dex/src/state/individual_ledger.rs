use anchor_lang::prelude::*;
use crate::common::MAX_TOKEN_MINTS;
use crate::common::USER_ORDERBOOK_CAP;

pub const INDIVIDUAL_LEDGER_SEED: &[u8] = b"user_ledger";
pub const USER_ORDERBOOK_SEED: &[u8] = b"user_orderbook";
pub const INDIVIDUAL_TOKEN_LEDGER_SEED: &[u8] = b"individual_token_ledger";

#[error_code]
pub enum ErrorCode {
    MaxTokensReached,
    OrderNotFound,

    OrderbookCapacityReached,
}

#[account]
pub struct IndividualLedgerAccount {
    pub tokens: [Pubkey; MAX_TOKEN_MINTS],
    pub next_index: u16,
    pub bitmap: [u8; MAX_TOKEN_MINTS],
    pub bump: u8,
}

impl IndividualLedgerAccount {
    pub fn init(&mut self) {
        self.next_index = 0;
        self.bump = 0; // Set the bump to 0 initially
        for i in 0..MAX_TOKEN_MINTS {
            self.tokens[i] = Pubkey::default();
            self.bitmap[i] = 0;
        }
    }

    pub fn add_token(&mut self, token: Pubkey) -> Result<()> {
        if self.next_index as usize == MAX_TOKEN_MINTS {
            return Err(ErrorCode::MaxTokensReached.into());
        }
        self.tokens[self.next_index as usize] = token;
        self.bitmap[self.next_index as usize] = 1; // Mark this token as used
        self.next_index += 1;
        Ok(())
    }
}

#[account]
#[derive(Debug)]
pub struct UserOrderbook {
    pub orders: [u128; USER_ORDERBOOK_CAP],
    pub next_index: u16,
    pub bitmap: [u8; USER_ORDERBOOK_CAP],
    pub bump: u8,
}

impl Default for UserOrderbook {
    fn default() -> Self {
        Self {
            orders: [0; USER_ORDERBOOK_CAP],
            next_index: 0,
            bitmap: [0; USER_ORDERBOOK_CAP],
            bump: 0,
        }
    }
}

impl UserOrderbook {
    pub fn init(&mut self) {
        self.next_index = 0;
        self.bump = 0; // Set the bump to 0 initially
        for i in 0..USER_ORDERBOOK_CAP {
            self.orders[i] = 0;
            self.bitmap[i] = 0;
        }
    }

    pub fn add_order(&mut self, order: u128) -> Result<()> {
        if self.next_index as usize == USER_ORDERBOOK_CAP {
            return Err(ErrorCode::OrderbookCapacityReached.into());
        }
        self.orders[self.next_index as usize] = order;
        self.bitmap[self.next_index as usize] = 1; // Mark this order as used
        self.next_index += 1;
        Ok(())
    }
    
    pub fn remove_order(&mut self, order: u128) -> Result<()> {
        let hit_index = self.orders.iter().position(|&x| x == order);

        let index = hit_index.ok_or(ErrorCode::OrderNotFound)?;
        for i in index..(self.next_index as usize - 1) {
            self.orders[i] = self.orders[i + 1];
            self.bitmap[i] = self.bitmap[i + 1];
        }
        self.orders[(self.next_index - 1) as usize] = 0; // Clear the last order
        self.bitmap[(self.next_index - 1) as usize] = 0; // Clear the last bitmap
        self.next_index -= 1;
        Ok(())
    }

    pub fn try_remove_order(&mut self, order: u128) {
        let hit_index = self.orders.iter().position(|&x| x == order);

        let index;
        match hit_index {
            Some(i) => index = i,
            None => {return;} // If not found, do nothing
        }
        for i in index..(self.next_index as usize - 1) {
            self.orders[i] = self.orders[i + 1];
            self.bitmap[i] = self.bitmap[i + 1];
        }
        self.orders[(self.next_index - 1) as usize] = 0; // Clear the last order
        self.bitmap[(self.next_index - 1) as usize] = 0; // Clear the last bitmap
        self.next_index -= 1;
    }
}

#[account]
pub struct IndividualTokenLedgerAccount {
    pub available_balance: u64,
    pub locked_balance: u64,
    pub mint_account: Pubkey,
    pub user_token_account: Pubkey,
    pub bump: u8,
}