use anchor_lang::prelude::*;
use crate::common::MAX_TOKEN_MINTS;
use crate::common::ErrorCode;

pub const INDIVIDUAL_LEDGER_SEED: &[u8] = b"user_ledger";
pub const USER_ORDERBOOK_SEED: &[u8] = b"user_orderbook";
pub const INDIVIDUAL_TOKEN_LEDGER_SEED: &[u8] = b"individual_token_ledger";

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
#[derive(Debug, Default)]
pub struct UserOrderbook {
    pub orders: [u128; MAX_TOKEN_MINTS],
    pub next_index: u16,
    pub bitmap: [u8; MAX_TOKEN_MINTS],
    pub bump: u8,
}

impl UserOrderbook {
    pub fn init(&mut self) {
        self.next_index = 0;
        self.bump = 0; // Set the bump to 0 initially
        for i in 0..MAX_TOKEN_MINTS {
            self.orders[i] = 0;
            self.bitmap[i] = 0;
        }
    }

    pub fn add_order(&mut self, order: u128) -> Result<()> {
        if self.next_index as usize == MAX_TOKEN_MINTS {
            return Err(ErrorCode::MaxTokensReached.into());
        }
        self.orders[self.next_index as usize] = order;
        self.bitmap[self.next_index as usize] = 1; // Mark this order as used
        self.next_index += 1;
        Ok(())
    }
    
    pub fn remove_order(&mut self, order: u128) -> Result<()> {
        let hit_index = self.orders.iter().position(|&x| x == order);
        if hit_index.is_none() {
            return Err(ErrorCode::OrderNotFound.into());
        }
        let index = hit_index.unwrap();
        for i in index..(self.next_index as usize - 1) {
            self.orders[i] = self.orders[i + 1];
            self.bitmap[i] = self.bitmap[i + 1];
        }
        self.orders[(self.next_index - 1) as usize] = 0; // Clear the last order
        self.bitmap[(self.next_index - 1) as usize] = 0; // Clear the last bitmap
        self.next_index -= 1;
        Ok(())
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