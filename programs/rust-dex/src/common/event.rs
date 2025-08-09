use anchor_lang::prelude::*;

use crate::{common::{OrderRequest, OrderSide, OrderType}, OrderNode};

#[event]
pub struct AcceptedOrderEvent {
    pub order_id: u64,
    pub owner: Pubkey,
    pub base_token: Pubkey,
    pub quote_token: Pubkey,
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
            base_token: if order.order_side == OrderSide::Buy { order.buy_token } else { order.sell_token },
            quote_token: if order.order_side == OrderSide::Buy { order.sell_token } else { order.buy_token },
            price: order.sell_quantity as f64 / order.buy_quantity as f64, // Assuming price is calculated as sell/buy
            amount: if order.order_side == OrderSide::Buy {
                order.buy_quantity
            } else {
                order.sell_quantity
            },
            order_type: if order.order_type == OrderType::Limit { "Limit".to_string() } else { "Market".to_string() },
            side: if order.order_side == OrderSide::Buy { "Buy".to_string() } else { "Sell".to_string() },
            timestamp: Clock::get().unwrap().unix_timestamp,
        }
    }
}

#[event]
pub struct CanceledOrderEvent {
    pub order_id: u64,
    pub owner: Pubkey,
    pub buy_token: Pubkey,
    pub sell_token: Pubkey,
    pub sell_quantity: u64,
    pub buy_quantity: u64,
    pub order_type: String, // "Limit" or "Market"
    pub timestamp: i64,
}

impl CanceledOrderEvent {
    pub fn from_order_node(order: &OrderNode, order_type: OrderType) -> Self {
        Self {
            order_id: order.id,
            owner: order.owner,
            buy_token: order.buy_token,
            sell_token: order.sell_token,
            sell_quantity: order.sell_quantity,
            buy_quantity: order.buy_quantity,
            order_type: if order_type == OrderType::Limit { "Limit".to_string() } else { "Market".to_string() },
            timestamp: Clock::get().unwrap().unix_timestamp,
        }
    }
    
}

#[event]
pub struct FilledOrderEvent {
    pub order_id: u64,
    pub owner: Pubkey,
    pub buy_token: Pubkey,
    pub sell_token: Pubkey,
    pub sell_quantity: u64,
    pub buy_quantity: u64,
    pub order_type: String, // "Limit" or "Market"
    pub timestamp: i64,
}

impl FilledOrderEvent {
    pub fn from_order_node(order: &OrderNode, order_type: OrderType) -> Self {
        Self {
            order_id: order.id,
            owner: order.owner,
            buy_token: order.buy_token,
            sell_token: order.sell_token,
            sell_quantity: order.sell_quantity,
            buy_quantity: order.buy_quantity,
            order_type: if order_type == OrderType::Limit { "Limit".to_string() } else { "Market".to_string() },
            timestamp: Clock::get().unwrap().unix_timestamp,
        }
    }
}

#[event]
pub struct PartiallyFilledOrderEvent {
    pub order_id: u64,
    pub owner: Pubkey,
    pub buy_token: Pubkey,
    pub sell_token: Pubkey,
    pub sell_quantity: u64,
    pub buy_quantity: u64,
    pub order_type: String, // "Limit" or "Market"
    pub timestamp: i64,
}

impl PartiallyFilledOrderEvent {
    pub fn from_order_node(
        order_id: u64,
        owner: Pubkey,
        buy_token: Pubkey,
        sell_token: Pubkey,
        buy_quantity: u64,
        sell_quantity: u64,
        order_type: OrderType,
    ) -> Self {
        Self {
            order_id,
            owner,
            buy_token,
            sell_token,
            buy_quantity,
            sell_quantity,
            order_type: if order_type == OrderType::Limit { "Limit".to_string() } else { "Market".to_string() },
            timestamp: Clock::get().unwrap().unix_timestamp,
        }
    }
}

#[event]
pub struct NoMatchedOrderEvent {
    pub order_id: u64,
    pub owner: Pubkey,
    pub buy_token: Pubkey,
    pub sell_token: Pubkey,
    pub sell_quantity: u64,
    pub buy_quantity: u64,
    pub order_type: String, // "Limit" or "Market"
    pub timestamp: i64,
}

impl NoMatchedOrderEvent {
    pub fn from_order_node(order: &OrderNode, order_type: OrderType) -> Self {
        Self {
            order_id: order.id,
            owner: order.owner,
            buy_token: order.buy_token,
            sell_token: order.sell_token,
            sell_quantity: order.sell_quantity,
            buy_quantity: order.buy_quantity,
            order_type: if order_type == OrderType::Limit { "Limit".to_string() } else { "Market".to_string() },
            timestamp: Clock::get().unwrap().unix_timestamp,
        }
    }
}


#[event]
pub struct InternalErrorEvent {
    pub error_message: String,
    pub timestamp: i64,
}

impl InternalErrorEvent {
    pub fn new(error_message: String) -> Self {
        Self {
            error_message,
            timestamp: Clock::get().unwrap().unix_timestamp,
        }
    }
}