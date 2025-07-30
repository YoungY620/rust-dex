use anchor_lang::prelude::*;

use crate::{common::{OrderRequest, OrderSide, OrderType}, OrderNode};

#[event]
pub struct AcceptedOrderEvent {
    pub order_id: u64,
    pub owner: Pubkey,
    pub base_asset: Pubkey,
    pub quote_asset: Pubkey,
    pub price: f64,
    pub amount: u64,
    pub order_type: String, // "Limit" or "Market"
    pub side: String, // "Buy" or "Sell"
    pub timestamp: i64,
}

impl AcceptedOrderEvent {
    pub fn from_order_request(order: &OrderRequest) -> Self {
        Self {
            order_id: order.id,
            owner: order.owner,
            base_asset: if order.order_side == OrderSide::Buy { order.buy_token } else { order.sell_token },
            quote_asset: if order.order_side == OrderSide::Buy { order.sell_token } else { order.buy_token },
            price: order.sell_quantity as f64 / order.buy_quantity as f64, // Assuming price is calculated as sell/buy
            amount: if order.order_side == OrderSide::Buy {
                order.buy_quantity
            } else {
                order.sell_quantity
            },
            order_type: if order.order_type == OrderType::Limit { "Limit".to_string() } else { "Market".to_string() },
            side: if order.order_side == OrderSide::Buy { "Buy".to_string() } else { "Sell".to_string() },
            timestamp: order.timestamp,
        }
    }
}

#[event]
pub struct CanceledOrderEvent {
    pub order_id: u64,
    pub owner: Pubkey,
    pub base_asset: Pubkey,
    pub quote_asset: Pubkey,
    pub price: u64,
    pub amount: u64,
    pub order_type: String, // "Limit" or "Market"
    pub side: String, // "Buy" or "Sell"
    pub timestamp: i64,
}

impl CanceledOrderEvent {
    pub fn from_order_request(order: &OrderRequest) -> Self {
        Self {
            order_id: order.id,
            owner: order.owner,
            base_asset: if order.order_side == OrderSide::Buy { order.buy_token } else { order.sell_token },
            quote_asset: if order.order_side == OrderSide::Buy { order.sell_token } else { order.buy_token },
            price: (order.sell_quantity as f64 / order.buy_quantity as f64) as u64, // Assuming price is calculated as sell/buy
            amount: if order.order_side == OrderSide::Buy {
                order.buy_quantity
            } else {
                order.sell_quantity
            },
            order_type: if order.order_type == OrderType::Limit { "Limit".to_string() } else { "Market".to_string() },
            side: if order.order_side == OrderSide::Buy { "Buy".to_string() } else { "Sell".to_string() },
            timestamp: order.timestamp,
        }
    }
    
}

#[event]
pub struct FilledOrderEvent {
    pub order_id: u64,
    pub owner: Pubkey,
    pub base_asset: Pubkey,
    pub quote_asset: Pubkey,
    pub price: u64,
    pub amount: u64,
    pub order_type: String, // "Limit" or "Market"
    pub side: String, // "Buy" or "Sell"
    pub timestamp: i64,
}

impl FilledOrderEvent {
    pub fn from_order_request(order: &OrderRequest) -> Self {
        Self {
            order_id: order.id,
            owner: order.owner,
            base_asset: if order.order_side == OrderSide::Buy { order.buy_token } else { order.sell_token },
            quote_asset: if order.order_side == OrderSide::Buy { order.sell_token } else { order.buy_token },
            price: (order.sell_quantity as f64 / order.buy_quantity as f64) as u64, // Assuming price is calculated as sell/buy
            amount: if order.order_side == OrderSide::Buy {
                order.buy_quantity
            } else {
                order.sell_quantity
            },
            order_type: if order.order_type == OrderType::Limit { "Limit".to_string() } else { "Market".to_string() },
            side: if order.order_side == OrderSide::Buy { "Buy".to_string() } else { "Sell".to_string() },
            timestamp: order.timestamp,
        }
    }
}

#[event]
pub struct PartiallyFilledOrderEvent {
    pub order_id: u64,
    pub owner: Pubkey,
    pub base_asset: Pubkey,
    pub quote_asset: Pubkey,
    pub price: u64,
    pub amount: u64,
    pub filled_amount: u64,
    pub order_type: String, // "Limit" or "Market"
    pub side: String, // "Buy" or "Sell"
    pub timestamp: i64,
}

impl PartiallyFilledOrderEvent {
    pub fn from_order_request(order: &OrderRequest, filled_amount: u64) -> Self {
        Self {
            order_id: order.id,
            owner: order.owner,
            base_asset: if order.order_side == OrderSide::Buy { order.buy_token } else { order.sell_token },
            quote_asset: if order.order_side == OrderSide::Buy { order.sell_token } else { order.buy_token },
            price: (order.sell_quantity as f64 / order.buy_quantity as f64) as u64, // Assuming price is calculated as sell/buy
            amount: if order.order_side == OrderSide::Buy {
                order.buy_quantity
            } else {
                order.sell_quantity
            },
            filled_amount,
            order_type: if order.order_type == OrderType::Limit { "Limit".to_string() } else { "Market".to_string() },
            side: if order.order_side == OrderSide::Buy { "Buy".to_string() } else { "Sell".to_string() },
            timestamp: order.timestamp,
        }
    }
}

#[event]
pub struct NoMatchedOrderEvent {
    pub order_id: u64,
    pub owner: Pubkey,
    pub base_asset: Pubkey,
    pub quote_asset: Pubkey,
    pub price: u64,
    pub amount: u64,
    pub order_type: String, // "Limit" or "Market"
    pub side: String, // "Buy" or "Sell"
    pub timestamp: i64,
}
impl NoMatchedOrderEvent {
    pub fn from_order (order: &OrderNode) -> Self {
        Self {
            order_id: order.id,
            owner: order.owner,
            base_asset: if order.order_side == OrderSide::Buy { order.buy_token } else { order.sell_token },
            quote_asset: if order.order_side == OrderSide::Buy { order.sell_token } else { order.buy_token },
            price: (order.sell_quantity as f64 / order.buy_quantity as f64) as u64, // Assuming price is calculated as sell/buy
            amount: if order.order_side == OrderSide::Buy {
                order.buy_quantity
            } else {
                order.sell_quantity
            },
            order_type: if order.order_type == OrderType::Limit { "Limit".to_string() } else { "Market".to_string() },
            side: if order.order_side == OrderSide::Buy { "Buy".to_string() } else { "Sell".to_string() },
            timestamp: order.timestamp,
        }
    }
}
