use std::{char::MAX, fmt::Debug, result::Result};

use anchor_lang::prelude::{Clock, Pubkey, SolanaSysvar};

use crate::{common::{OrderRequest, OrderType, MAX_EVENTS}, state::{OrderHeap, OrderNode}};


#[derive(Debug, Clone)]
pub enum OrderSuccess {
    Accepted{
        order_id: u64,
        order_type: OrderType,
        block_time: i64        
    },
    Filled{
        order_id: u64,
        order_type: OrderType,
        sell_quantity: u64,
        buy_quantity: u64,
        block_time: i64
    },
    PartialFilled{
        order_id: u64,
        order_type: OrderType,
        sell_quantity: u64,
        buy_quantity: u64,
        block_time: i64
    },
    Cancelled{
        order_id: u64,
        block_time: i64
    }
}

#[derive(Debug, Clone)]
pub enum OrderFailed {
    TooManyEvents(u64),
    OrderHeapFull(u64),
    NoMatch(u64),
    OrderNotFound(u64),
}

type OrderProcessResult = Vec<Result<OrderSuccess, OrderFailed>>;

#[derive(Debug)]
pub struct OrderBook<'a> {
    pub order_token: Pubkey,
    pub price_order: Pubkey,
    pub buy_queue: &'a mut OrderHeap,
    pub sell_queue: &'a mut OrderHeap,
}

impl<'a> OrderBook<'a> {
    pub fn new(order_token: Pubkey, price_order: Pubkey, buy_queue: &'a mut OrderHeap, sell_queue: &'a mut OrderHeap) -> Self {
        Self {
            order_token,
            price_order,
            buy_queue,
            sell_queue,
        }
    }
    
    pub fn process_order(&mut self, order: OrderRequest) -> OrderProcessResult {
        let mut result: OrderProcessResult = Vec::new();
        let order_node = OrderNode::new(
            order.id,
            order.buy_quantity,
            order.sell_quantity,
            order.buy_token,
            order.sell_token,
            order.owner,
            order.timestamp,
        );
        match order.order_type {
            OrderType::Limit => {
                result.push(Result::Ok(OrderSuccess::Accepted {
                    order_id: order.id,
                    order_type: order.order_type,
                    block_time: Clock::get().unwrap().unix_timestamp as i64
                }));

                Self::process_limit_order(&mut self.buy_queue, &mut self.sell_queue, order_node, &mut result);
            },
            OrderType::Market => {
                result.push(Result::Ok(OrderSuccess::Accepted{
                    order_id: order.id,
                    order_type: order.order_type,
                    block_time: Clock::get().unwrap().unix_timestamp as i64
                }));
                Self::process_market_order(&mut self.buy_queue, &mut self.sell_queue, order_node, &mut result);
            }
        }
        result
    }

    fn process_limit_order(
        buy_queue: &mut OrderHeap,
        sell_queue: &mut OrderHeap,
        mut order: OrderNode,
        result: &mut OrderProcessResult
    ) { 
        if let Some(sell_order) = sell_queue.get_best_order() {
            let match_available = sell_order.sell_price() <= order.buy_price();
            if result.len() < MAX_EVENTS - 2  {
                result.push(Result::Err(OrderFailed::TooManyEvents(order.id)));
                return; 
            }
            if match_available {
                let completed = Self::order_match(&mut order, sell_queue, result, OrderType::Limit);

                if !completed {
                    Self::process_limit_order(buy_queue, sell_queue, order, result);
                }
            }else {
                if let Err(_) = buy_queue.add_order(order) {
                    result.push(Result::Err(OrderFailed::OrderHeapFull(order.id)));
                }
            }
        } else {
            if let Err(_) = buy_queue.add_order(order) {
                result.push(Result::Err(OrderFailed::OrderHeapFull(order.id)));
            }
        }
    }

    fn order_match(
        order: &mut OrderNode,
        sell_queue: &mut OrderHeap,
        result: &mut OrderProcessResult,
        order_type: OrderType
    ) -> bool {
        let best_sell_order = sell_queue.get_best_order().unwrap();
        let oppo_buy_quantity = best_sell_order.buy_quantity;
        if order.sell_quantity < oppo_buy_quantity {
            let buy_quantity = order.sell_quantity * best_sell_order.sell_price() as u64;
            result.push(Result::Ok(OrderSuccess::Filled { 
                order_id: order.id, 
                order_type: order_type, 
                sell_quantity: order.sell_quantity,
                buy_quantity: buy_quantity,
                block_time: Clock::get().unwrap().unix_timestamp as i64
            }));
            let oppo_sell_order_mut = sell_queue.get_best_order_mut().unwrap();
            oppo_sell_order_mut.sell_quantity -= buy_quantity;
            oppo_sell_order_mut.buy_quantity -= order.sell_quantity;
            result.push(Result::Ok(OrderSuccess::PartialFilled {
                order_id: oppo_sell_order_mut.id,
                order_type: OrderType::Limit,
                sell_quantity: buy_quantity,
                buy_quantity: order.sell_quantity,
                block_time: Clock::get().unwrap().unix_timestamp as i64
            }));
            return true;
        } else if order.sell_quantity > oppo_buy_quantity {
            let oppo_sell_order_mut = sell_queue.get_best_order_mut().unwrap();
            
            result.push(Result::Ok(OrderSuccess::PartialFilled {
                order_id: order.id,
                order_type: order_type,
                sell_quantity: oppo_sell_order_mut.buy_quantity,
                buy_quantity: oppo_sell_order_mut.sell_quantity,
                block_time: Clock::get().unwrap().unix_timestamp as i64
            }));
            order.sell_quantity -= oppo_sell_order_mut.buy_quantity;
            if order_type == OrderType::Limit {
                order.buy_quantity -= oppo_sell_order_mut.sell_quantity;
            }
            result.push(Result::Ok(OrderSuccess::Filled {
                order_id: oppo_sell_order_mut.id,
                order_type: OrderType::Limit,
                sell_quantity: oppo_sell_order_mut.sell_quantity,
                buy_quantity: oppo_sell_order_mut.buy_quantity,
                block_time: Clock::get().unwrap().unix_timestamp as i64
            }));
            let opposite_order_id = oppo_sell_order_mut.id;
            if let Err(_) = sell_queue.remove_order(opposite_order_id) {
                result.push(Result::Err(OrderFailed::OrderNotFound(opposite_order_id)));
            }
            return false;
        } else {
            let oppo_order_mut = sell_queue.get_best_order_mut().unwrap();
            result.push(Result::Ok(OrderSuccess::Filled {
                order_id: order.id,
                order_type: order_type,
                sell_quantity: oppo_order_mut.buy_quantity,
                buy_quantity: oppo_order_mut.sell_quantity,
                block_time: Clock::get().unwrap().unix_timestamp as i64
            }));
            result.push(Result::Ok(OrderSuccess::Filled {
                order_id: oppo_order_mut.id,
                order_type: OrderType::Limit,
                sell_quantity: oppo_order_mut.sell_quantity,
                buy_quantity: oppo_order_mut.buy_quantity,
                block_time: Clock::get().unwrap().unix_timestamp as i64
            }));
            let opposite_order_id = oppo_order_mut.id;
            if let Err(_) = sell_queue.remove_order(opposite_order_id) {
                result.push(Result::Err(OrderFailed::OrderNotFound(opposite_order_id)));
            }
            return true;
        }
    }

    fn process_market_order(
        buy_queue: &mut OrderHeap,
        sell_queue: &mut OrderHeap,
        mut order: OrderNode,
        result: &mut OrderProcessResult
    ) {
        if result.len() < MAX_EVENTS - 2  {
                result.push(Result::Err(OrderFailed::TooManyEvents(order.id)));
                return;
        } 
        if let Some(_opposite_order) = sell_queue.get_best_order() {
            let completed = Self::order_match(&mut order, sell_queue, result, OrderType::Market);

            if !completed {
                Self::process_market_order(buy_queue, sell_queue, order, result);
            }
        } else {
            result.push(Result::Err(OrderFailed::NoMatch(order.id)));
        }
    }
}
