use std::cmp::Ordering;

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::hash::{Hasher};
use anchor_lang::prelude::*;

#[derive(Debug, Clone, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub enum OrderSide {
    Buy,
    Sell
}

#[derive(Debug, Clone, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub enum OrderType {
    Limit,
    Market
}

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct Order {
    pub id: u128,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub price: f64,
    pub quantity: u64,
    pub owner: Pubkey
}

impl Order {
    pub fn new(side: OrderSide, order_type: OrderType, price: f64, quantity: u64, owner: Pubkey) -> Result<Self> {
        let clock = Clock::get()?;
        
        let mut hasher = Hasher::default();
        hasher.hash(&[side.clone() as u8]);
        hasher.hash(&[order_type.clone() as u8]);
        hasher.hash(&price.to_be_bytes());
        hasher.hash(&quantity.to_be_bytes());
        hasher.hash(&owner.to_bytes());
        hasher.hash(&clock.unix_timestamp.to_be_bytes());
        let hash_value = hasher.result().to_bytes().to_vec();
        let mut hash_bytes = [0u8; 16];
        hash_bytes.copy_from_slice(&hash_value[..16]);
        let hash_as_u128 = u128::from_be_bytes(hash_bytes);
        let priority = ((clock.unix_timestamp as u128) << 64) | hash_as_u128;
        
        Ok(Self {
            id: priority,
            side,
            order_type,
            price,
            quantity,
            owner
        })
    }
}

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct OrderIndex {
    pub id: u128,
    pub price: u128,
    pub order_side: OrderSide
}

impl OrderIndex {
    pub fn new(order: &Order) -> Self {
        Self {
            id: order.id,
            price: order.price as u128,
            order_side: order.side.clone()
        }
    }
}

impl Ord for OrderIndex {
    fn cmp(&self, other: &Self) -> Ordering {
        match self.order_side {
            OrderSide::Buy => {
                // For Buy orders, higher price is better
                other.price.cmp(&self.price).then_with(|| self.id.cmp(&other.id))
            },
            OrderSide::Sell => {
                // For Sell orders, lower price is better
                self.price.cmp(&other.price).then_with(|| self.id.cmp(&other.id))
            }
        }
    }
}


impl PartialOrd for OrderIndex {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
    
    fn lt(&self, other: &Self) -> bool {
        self.partial_cmp(other).is_some_and(std::cmp::Ordering::is_lt)
    }
    
    fn le(&self, other: &Self) -> bool {
        self.partial_cmp(other).is_some_and(std::cmp::Ordering::is_le)
    }
    
    fn gt(&self, other: &Self) -> bool {
        self.partial_cmp(other).is_some_and(std::cmp::Ordering::is_gt)
    }
    
    fn ge(&self, other: &Self) -> bool {
        self.partial_cmp(other).is_some_and(std::cmp::Ordering::is_ge)
    }
}

impl PartialEq for OrderIndex {
    fn eq(&self, other: &Self) -> bool {
        if self.price > other.price || self.price < other.price {
            false
        } else {
            self.id == other.id
        }
    }
}

impl Eq for OrderIndex {}