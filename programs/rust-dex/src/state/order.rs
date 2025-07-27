use std::cmp::Ordering;
use std::f32::INFINITY;

use anchor_lang::prelude::*;


#[zero_copy]
#[derive(Debug, Default)]
pub struct OrderNode {
    pub id: u64,
    pub buy_quantity: u64,
    pub sell_quantity: u64,
    pub buy_token: Pubkey,
    pub sell_token: Pubkey,
    pub owner: Pubkey,
    pub timestamp: i64,
}

impl OrderNode {
    pub fn new(
        id: u64,
        buy_quantity: u64,
        sell_quantity: u64,
        buy_token: Pubkey,
        sell_token: Pubkey,
        owner: Pubkey,
        timestamp: i64,
    ) -> Self {
        Self {
            id,
            buy_quantity,
            sell_quantity,
            buy_token,
            sell_token,
            owner,
            timestamp,
        }
    }
    pub fn sell_price(&self) -> f64 {
        if  self.sell_quantity == 0 {
            0.0
        } else if self.buy_quantity == 0 {
            INFINITY as f64
        } else {
            self.sell_quantity as f64 / self.buy_quantity as f64
        }
    }
    pub fn buy_price(&self) -> f64 {
        if self.buy_quantity == 0 {
            0.0
        } else if self.sell_quantity == 0 {
            INFINITY as f64
        } else {
            self.buy_quantity as f64 / self.sell_quantity as f64
        }
    }
}

impl Ord for OrderNode {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        let self_price = self.sell_price() as f64;
        let other_price = other.sell_price() as f64;
        return if self_price > other_price {
            Ordering::Greater
        } else if self_price < other_price {
            Ordering::Less
        } else {
            self.id.cmp(&other.id) // If prices are equal, compare by ID
        };
    }
}
impl PartialOrd for OrderNode {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Eq for OrderNode {}

impl PartialEq for OrderNode {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
