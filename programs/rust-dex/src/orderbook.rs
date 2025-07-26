use std::{fmt::Debug, result::Result};

use borsh::{BorshDeserialize, BorshSerialize};

use crate::orderqueue::{OrderQueue};
use crate::order::{Order, OrderSide, OrderType};

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub enum OrderSuccess {
    Accepted{
        order_id: u128,
        order_type: OrderType,
        block_time: i64        
    },
    Filled{
        order_id: u128,
        side: OrderSide,
        order_type: OrderType,
        price: f64,
        quantity: u64,
        block_time: i64
    },
    PartialFilled{
        order_id: u128,
        side: OrderSide,
        order_type: OrderType,
        price: f64,
        quantity: u64,
        block_time: i64
    },
    Cancelled{
        order_id: u64,
        block_time: i64
    }
}

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub enum OrderFailed {
    ValidationFailed(String),
    DuplicateOrderID(u64),
    NoMatch(u128),
    OrderNotFound(u64),
}

type OrderProcessResult = Vec<Result<OrderSuccess, OrderFailed>>;

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct OrderBook {
    pub order_token: Pubkey,
    pub price_order: Pubkey,
    pub buy_queue: OrderQueue,
    pub sel_queue: OrderQueue
}

impl OrderBook {
    pub fn new(order_token: Pubkey, price_order: Pubkey) -> Self {
        Self {
            order_token,
            price_order,
            buy_queue: OrderQueue::new(),
            sel_queue: OrderQueue::new()
        }
    }
    
    pub fn process_order(&mut self, order: Order) -> OrderProcessResult {
        let mut result: OrderProcessResult = Vec::new();
        match order.order_type {
            OrderType::Limit => {
                result.push(Result::Ok(OrderSuccess::Accepted {
                    order_id: order.id,
                    order_type: order.order_type.clone(),
                    block_time: Clock::get().unwrap().unix_timestamp as i64
                }));

                Self::process_limit_order(&mut self.buy_queue, &mut self.sel_queue, order, &mut result);
            },
            OrderType::Market => {
                result.push(Result::Ok(OrderSuccess::Accepted{
                    order_id: order.id,
                    order_type: order.order_type.clone(),
                    block_time: Clock::get().unwrap().unix_timestamp as i64
                }));

                Self::process_market_order(&mut self.buy_queue, &mut self.sel_queue, order, &mut result);
            }
        }
        result
    }

    fn process_limit_order(
        buy_queue: &mut OrderQueue,
        sel_queue: &mut OrderQueue,
        mut order: Order,
        result: &mut OrderProcessResult
    ) {
        let (opposite_queue, self_queue) = if order.side == OrderSide::Buy {
            (&mut *sel_queue, &mut *buy_queue)
        } else {
            (&mut *buy_queue, &mut *sel_queue)
        };
        
        if let Some(opposite_order) = opposite_queue.peek_highest_priority() {
            let matching_available = match order.side {
                OrderSide::Buy => order.price >= opposite_order.price,
                OrderSide::Sell => order.price <= opposite_order.price
            };
            if matching_available {
                let completed = Self::order_match(&mut order, opposite_queue, result);
                
                if !completed {
                    Self::process_limit_order(buy_queue, sel_queue, order, result);
                }
            }else {
                self_queue.add_order(order);
            }
        } else {
            self_queue.add_order(order);
        }
    }

    fn order_match(
        order: &mut Order,
        opposite_queue: &mut OrderQueue,
        result: &mut OrderProcessResult,
    ) -> bool {
        let opposite_quantity = opposite_queue.pop_highest_priority().unwrap().quantity;
        if order.quantity < opposite_quantity {
            result.push(Result::Ok(OrderSuccess::Filled { 
                order_id: order.id, 
                side: order.side.clone(), 
                order_type: order.order_type.clone(), 
                price: order.price, 
                quantity: order.quantity, 
                block_time: Clock::get().unwrap().unix_timestamp as i64 
            }));

            {
                let opposite_order = opposite_queue.peek_highest_priority().unwrap();
                result.push(Result::Ok(OrderSuccess::PartialFilled { 
                    order_id: opposite_order.id, 
                    side: opposite_order.side.clone(), 
                    order_type: opposite_order.order_type.clone(), 
                    price: opposite_order.price, 
                    quantity: order.quantity, 
                    block_time: Clock::get().unwrap().unix_timestamp as i64 
                }));
            }
            opposite_queue.peek_highest_priority_mut().unwrap().quantity -= order.quantity;
            return true;
        } else if order.quantity > opposite_quantity {
            {
                let opposite_order = opposite_queue.peek_highest_priority().unwrap();
                result.push(Result::Ok(OrderSuccess::PartialFilled {
                    order_id: order.id,
                    side: order.side.clone(),
                    order_type: order.order_type.clone(),
                    price: order.price,
                    quantity: opposite_order.quantity,
                    block_time: Clock::get().unwrap().unix_timestamp as i64
                }));
                result.push(Result::Ok(OrderSuccess::Filled {
                    order_id: opposite_order.id,
                    side: opposite_order.side.clone(),
                    order_type: opposite_order.order_type.clone(),
                    price: opposite_order.price,
                    quantity: opposite_order.quantity,
                    block_time: Clock::get().unwrap().unix_timestamp as i64
                }));
            }
            let opposite_order_id = opposite_queue.peek_highest_priority().unwrap().id;
            opposite_queue.remove_order(opposite_order_id);
            order.quantity -= opposite_quantity;
            return false;
        } else {
            result.push(Result::Ok(OrderSuccess::Filled {
                order_id: order.id,
                side: order.side.clone(),
                order_type: order.order_type.clone(),
                price: order.price,
                quantity: order.quantity,
                block_time: Clock::get().unwrap().unix_timestamp as i64
            }));
            {
                let opposite_order = opposite_queue.peek_highest_priority().unwrap();
                result.push(Result::Ok(OrderSuccess::Filled {
                    order_id: opposite_order.id,
                    side: opposite_order.side.clone(),
                    order_type: opposite_order.order_type.clone(),
                    price: opposite_order.price,
                    quantity: opposite_order.quantity,
                    block_time: Clock::get().unwrap().unix_timestamp as i64
                }));
            }
            let opposite_order_id = opposite_queue.peek_highest_priority().unwrap().id;
            opposite_queue.remove_order(opposite_order_id);
            return true;
        }
    }

    fn process_market_order(
        buy_queue: &mut OrderQueue,
        sel_queue: &mut OrderQueue,
        mut order: Order,
        result: &mut OrderProcessResult
    ) {
        let opposite_queue = if order.side == OrderSide::Buy {
            &mut *sel_queue
        } else {
            &mut *buy_queue
        };
        if let Some(_opposite_order) = opposite_queue.peek_highest_priority() {
            let completed = Self::order_match(&mut order, opposite_queue, result);
            
            if !completed {
                Self::process_limit_order(buy_queue, sel_queue, order, result);
            }
        } else {
            result.push(Result::Err(OrderFailed::NoMatch(order.id)));
        }
    }
}
