use std::{fmt::Debug, result::Result};

use anchor_lang::error_code;
use anchor_lang::{emit, prelude::Pubkey};
use crate::common::NoMatchedOrderEvent;
use crate::OrderHeap;
use crate::{common::{AcceptedOrderEvent, FilledOrderEvent, OrderRequest, OrderType, PartiallyFilledOrderEvent, InternalErrorEvent, MAX_EVENTS}, state::OrderNode, UserOrderbook};


#[derive(Debug, Clone)]
pub enum OrderSuccess {
    Filled{
        _who: Pubkey,
        oppo_user: Pubkey,
        _order_id: u64,
        oppo_order_id: u64,
        _order_type: OrderType,
        sell_quantity: u64,
        buy_quantity: u64,
        filled: bool,
        oppo_filled: bool,
    },
}

#[error_code]
pub enum ErrorCode {
    OrderNotFound,
    OrderHeapFull,
    TooManyEvents,
    NoMatch,
    
}

#[derive(Debug, Clone)]
pub enum OrderFailure {
    TooManyEvents{
        who: Pubkey,
        _order_id: u64,
        _order_type: OrderType,
        sell_quantity: u64,
        buy_quantity: u64,
    },
    OrderHeapFull{
        who: Pubkey,
        _order_id: u64,
        _order_type: OrderType,
        sell_quantity: u64,
        buy_quantity: u64,
    },
    NoMatch{
        who: Pubkey,
        _order_id: u64,
        _order_type: OrderType,
        sell_quantity: u64,
        buy_quantity: u64,
    },
    OrderNotFound{
        _order_id: u64,
    },
}

type OrderProcessResult = Vec<Result<OrderSuccess, OrderFailure>>;

pub struct MatchingEngine<'a> {
    pub _buy_token: Pubkey,
    pub _sell_token: Pubkey,
    pub buy_queue: &'a mut dyn OrderHeap,
    pub sell_queue: &'a mut dyn OrderHeap,
    pub user_orderbook: &'a mut UserOrderbook,
}

impl<'a> MatchingEngine<'a> {
    pub fn new(buy_token: Pubkey, sell_token: Pubkey, buy_queue: &'a mut dyn OrderHeap, sell_queue: &'a mut dyn OrderHeap, user_orderbook: &'a mut UserOrderbook) -> Self {
        Self {
            _buy_token: buy_token,
            _sell_token: sell_token,
            buy_queue,
            sell_queue,
            user_orderbook,
        }
    }
    
    pub fn process_order(&mut self, order: OrderRequest, is_sell: bool) -> OrderProcessResult {
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
                emit!(AcceptedOrderEvent::from_order_request(&order));
                Self::process_limit_order(self.buy_queue, self.sell_queue, order_node, &mut result, self.user_orderbook, is_sell);
            },
            OrderType::Market => {
                emit!(AcceptedOrderEvent::from_order_request(&order));
                Self::process_market_order(self.buy_queue, self.sell_queue, order_node, &mut result, is_sell);
            }
        }
        result
    }

    fn process_limit_order(
        buy_queue: &mut dyn OrderHeap,
        sell_queue: &mut dyn OrderHeap,
        mut order: OrderNode,
        result: &mut OrderProcessResult,
        user_orderbook: &mut UserOrderbook,
        is_sell: bool,
    ) { 
        if let Some(sell_order) = sell_queue.get_best_order() {
            let match_available = sell_order.buy_price() >= order.sell_price();
            if result.len() + 2 > MAX_EVENTS  {
                result.push(Result::Err(OrderFailure::TooManyEvents{
                    who: order.owner,
                    _order_id: order.id,
                    _order_type: OrderType::Limit,
                    sell_quantity: order.sell_quantity,
                    buy_quantity: order.buy_quantity,
                }));
                return; 
            }
            if match_available {
                let completed = Self::order_match(&mut order, sell_queue, result, OrderType::Limit, is_sell);

                if !completed {
                    Self::process_limit_order(buy_queue, sell_queue, order, result, user_orderbook, is_sell);
                }
            }else {
                match user_orderbook.add_order(order.id as u128) {
                    Ok(_) => {
                        if let Err(_) = buy_queue.add_order(order) {
                            user_orderbook.try_remove_order(order.id as u128);
                            result.push(Result::Err(OrderFailure::OrderHeapFull { who: order.owner, _order_id: order.id, _order_type: OrderType::Limit, sell_quantity: order.sell_quantity, buy_quantity: order.buy_quantity }));
                        }
                    },
                    Err(e) => {
                        emit!(InternalErrorEvent::new(format!("Failed to add order to user orderbook: {}", e)));
                    }
                }
            }
        } else {
            match user_orderbook.add_order(order.id as u128) {
                Ok(_) => {
                    if let Err(_) = buy_queue.add_order(order) {
                        result.push(Result::Err(OrderFailure::OrderHeapFull { who: order.owner, _order_id: order.id, _order_type: OrderType::Limit, sell_quantity: order.sell_quantity, buy_quantity: order.buy_quantity }));
                    }
                },
                Err(e) => {
                    emit!(InternalErrorEvent::new(format!("Failed to add order to user orderbook: {}", e)));
                }
            }
        }
    }

    fn order_match_sell(
        order: &mut OrderNode,
        sell_queue: &mut dyn OrderHeap,
        result: &mut OrderProcessResult,
        order_type: OrderType
    ) -> bool {
        let best_sell_result = sell_queue.get_best_order();
        let best_sell_order: &OrderNode;
        match best_sell_result {
            Some(best_sell_inner) => {
                best_sell_order = best_sell_inner;
            },
            None => {
                return false;
            }
        }
        let oppo_buy_quantity = best_sell_order.buy_quantity;
        if order.sell_quantity < oppo_buy_quantity {
            let buy_quantity = order.sell_quantity * best_sell_order.buy_price() as u64;
            let oppo_sell_order_mut: &mut OrderNode;
            match sell_queue.get_best_order_mut() {
                Some(oppo_sell_inner) => {
                    oppo_sell_order_mut = oppo_sell_inner;
                },
                None => {
                    return false;
                }
            }
            oppo_sell_order_mut.sell_quantity -= buy_quantity;
            oppo_sell_order_mut.buy_quantity -= order.sell_quantity;
            result.push(Result::Ok(OrderSuccess::Filled { 
                _who: order.owner,
                oppo_user: oppo_sell_order_mut.owner,
                _order_id: order.id,
                oppo_order_id: oppo_sell_order_mut.id,
                _order_type: order_type,
                sell_quantity: order.sell_quantity,
                buy_quantity: buy_quantity,
                filled: true,
                oppo_filled: false,  // 对方订单未完全成交
            }));
            emit!(FilledOrderEvent::from_order_node(order, order_type));
            emit!(PartiallyFilledOrderEvent::from_order_node(
                oppo_sell_order_mut.id,
                oppo_sell_order_mut.owner,
                oppo_sell_order_mut.buy_token,
                oppo_sell_order_mut.sell_token,
                order.sell_quantity,
                buy_quantity,
                OrderType::Limit,
            ));
            return true;
        } else if order.sell_quantity > oppo_buy_quantity {
            let oppo_sell_order_mut: &mut OrderNode;
            match sell_queue.get_best_order_mut() {
                Some(order) => oppo_sell_order_mut = order,
                None => return false,
            }

            result.push(Result::Ok(OrderSuccess::Filled {
                _who: order.owner,
                oppo_user: oppo_sell_order_mut.owner,
                _order_id: order.id,
                oppo_order_id: oppo_sell_order_mut.id,
                _order_type: order_type,
                sell_quantity: oppo_sell_order_mut.buy_quantity,
                buy_quantity: oppo_sell_order_mut.sell_quantity,
                filled: false,  // 当前订单未完全成交
                oppo_filled: true,  // 对方订单已完全成交
            }));
            order.sell_quantity -= oppo_sell_order_mut.buy_quantity;
            if order_type == OrderType::Limit {
                order.buy_quantity -= oppo_sell_order_mut.sell_quantity;
            }
            let opposite_order_id = oppo_sell_order_mut.id;
            emit!(FilledOrderEvent::from_order_node(oppo_sell_order_mut, OrderType::Limit));
            emit!(PartiallyFilledOrderEvent::from_order_node(
                order.id,
                order.owner,
                order.buy_token,
                order.sell_token,
                oppo_sell_order_mut.sell_quantity,
                oppo_sell_order_mut.buy_quantity,
                order_type,
            ));
            if let Err(_) = sell_queue.remove_order(opposite_order_id) {
                result.push(Result::Err(OrderFailure::OrderNotFound{_order_id: opposite_order_id}));
            }
            return false;
        } else {
            let oppo_order_mut: &mut OrderNode;
            match sell_queue.get_best_order_mut() {
                Some(order) => oppo_order_mut = order,
                None => return false,
            }
            result.push(Result::Ok(OrderSuccess::Filled {
                _who: order.owner,
                oppo_user: oppo_order_mut.owner,
                oppo_order_id: oppo_order_mut.id,
                _order_id: order.id,
                _order_type: order_type,
                sell_quantity: oppo_order_mut.buy_quantity,
                buy_quantity: oppo_order_mut.sell_quantity,
                filled: true,
                oppo_filled: true,  // 双方订单完全成交
            }));
            emit!(FilledOrderEvent::from_order_node(oppo_order_mut, OrderType::Limit));
            emit!(FilledOrderEvent::from_order_node(order, order_type));
            let opposite_order_id = oppo_order_mut.id;
            if let Err(_) = sell_queue.remove_order(opposite_order_id) {
                result.push(Result::Err(OrderFailure::OrderNotFound{_order_id: opposite_order_id}));
            }
            return true;
        }
    }

    fn order_match_buy(
        order: &mut OrderNode,
        sell_queue: &mut dyn OrderHeap,
        result: &mut OrderProcessResult,
        order_type: OrderType
    ) -> bool {
        let best_sell_order: &OrderNode;
        match sell_queue.get_best_order() {
            Some(best_sell_inner) => {
                best_sell_order = best_sell_inner;
            },
            None => {
                return false;
            }
        }
        let oppo_sell_quantity = best_sell_order.sell_quantity;
        if order.buy_quantity < oppo_sell_quantity {
            let sell_quantity = order.buy_quantity * best_sell_order.sell_price() as u64;
            let oppo_sell_order_mut: &mut OrderNode;
            match sell_queue.get_best_order_mut() {
                Some(oppo_sell_inner) => {
                    oppo_sell_order_mut = oppo_sell_inner;
                },
                None => {
                    return false;
                }
            }
            oppo_sell_order_mut.buy_quantity -= sell_quantity;
            oppo_sell_order_mut.sell_quantity -= order.buy_quantity;
            result.push(Result::Ok(OrderSuccess::Filled { 
                _who: order.owner,
                oppo_user: oppo_sell_order_mut.owner,
                _order_id: order.id,
                oppo_order_id: oppo_sell_order_mut.id,
                _order_type: order_type,
                sell_quantity: sell_quantity,
                buy_quantity: order.buy_quantity,
                filled: true,
                oppo_filled: false,  // 对方订单未完全成交
            }));
            emit!(FilledOrderEvent::from_order_node(order, order_type));
            emit!(PartiallyFilledOrderEvent::from_order_node(
                oppo_sell_order_mut.id,
                oppo_sell_order_mut.owner,
                oppo_sell_order_mut.buy_token,
                oppo_sell_order_mut.sell_token,
                sell_quantity,
                order.buy_quantity,
                OrderType::Limit,
            ));
            return true;
        } else if order.buy_quantity > oppo_sell_quantity {
            let oppo_sell_order_mut: &mut OrderNode;
            match sell_queue.get_best_order_mut() {
                Some(order) => oppo_sell_order_mut = order,
                None => return false,
            }

            result.push(Result::Ok(OrderSuccess::Filled {
                _who: order.owner,
                oppo_user: oppo_sell_order_mut.owner,
                _order_id: order.id,
                oppo_order_id: oppo_sell_order_mut.id,
                _order_type: order_type,
                sell_quantity: oppo_sell_order_mut.buy_quantity,
                buy_quantity: oppo_sell_order_mut.sell_quantity,
                filled: false,  // 当前订单未完全成交
                oppo_filled: true,  // 对方订单已完全成交
            }));
            order.sell_quantity -= oppo_sell_order_mut.buy_quantity;
            order.buy_quantity -= oppo_sell_order_mut.sell_quantity;

            let opposite_order_id = oppo_sell_order_mut.id;
            emit!(FilledOrderEvent::from_order_node(oppo_sell_order_mut, OrderType::Limit));
            emit!(PartiallyFilledOrderEvent::from_order_node(
                order.id,
                order.owner,
                order.buy_token,
                order.sell_token,
                oppo_sell_order_mut.sell_quantity,
                oppo_sell_order_mut.buy_quantity,
                order_type,
            ));
            if let Err(_) = sell_queue.remove_order(opposite_order_id) {
                result.push(Result::Err(OrderFailure::OrderNotFound{_order_id: opposite_order_id}));
            }
            return false;
        } else {
            let oppo_order_mut: &mut OrderNode;
            match sell_queue.get_best_order_mut() {
                Some(order) => oppo_order_mut = order,
                None => return false,
            }
            result.push(Result::Ok(OrderSuccess::Filled {
                _who: order.owner,
                oppo_user: oppo_order_mut.owner,
                oppo_order_id: oppo_order_mut.id,
                _order_id: order.id,
                _order_type: order_type,
                sell_quantity: oppo_order_mut.buy_quantity,
                buy_quantity: oppo_order_mut.sell_quantity,
                filled: true,
                oppo_filled: true,  // 双方订单完全成交
            }));
            emit!(FilledOrderEvent::from_order_node(oppo_order_mut, OrderType::Limit));
            emit!(FilledOrderEvent::from_order_node(order, order_type));
            let opposite_order_id = oppo_order_mut.id;
            if let Err(_) = sell_queue.remove_order(opposite_order_id) {
                result.push(Result::Err(OrderFailure::OrderNotFound{_order_id: opposite_order_id}));
            }
            return true;
        }
    }

    fn order_match(
        order: &mut OrderNode,
        sell_queue: &mut dyn OrderHeap,
        result: &mut OrderProcessResult,
        order_type: OrderType,
        is_sell: bool,
    ) -> bool {
        if is_sell {
            Self::order_match_sell(order, sell_queue, result, order_type)
        } else {
            Self::order_match_buy(order, sell_queue, result, order_type)
        }
    }

    fn process_market_order(
        buy_queue: &mut dyn OrderHeap,
        sell_queue: &mut dyn OrderHeap,
        mut order: OrderNode,
        result: &mut OrderProcessResult,
        is_sell: bool
    ) {
        if result.len() + 2 > MAX_EVENTS  {
                result.push(Result::Err(OrderFailure::TooManyEvents{
                    who: order.owner,
                    _order_id: order.id,
                    _order_type: OrderType::Market,
                    sell_quantity: order.sell_quantity,
                    buy_quantity: order.buy_quantity,
                }));
                return;
        } 
        if let Some(_opposite_order) = sell_queue.get_best_order() {
            let completed = Self::order_match(&mut order, sell_queue, result, OrderType::Market, is_sell);

            if !completed {
                Self::process_market_order(buy_queue, sell_queue, order, result, is_sell);
            }
        } else {
            result.push(Result::Err(OrderFailure::NoMatch{
                who: order.owner,
                _order_id: order.id,
                _order_type: OrderType::Market,
                sell_quantity: order.sell_quantity,
                buy_quantity: order.buy_quantity,
            }));
            emit!(NoMatchedOrderEvent::from_order_node(&order, OrderType::Market));
        }
    }
}

