use std::{char::MAX, fmt::Debug, result::Result};

use anchor_lang::prelude::{Clock, Pubkey, SolanaSysvar};

use crate::{common::{OrderRequest, OrderType, MAX_EVENTS}, state::{OrderHeap, OrderNode}, UserOrderbook};


#[derive(Debug, Clone)]
pub enum OrderSuccess {
    Accepted{
        order_id: u64,
        order_type: OrderType,
    },
    Filled{
        who: Pubkey,
        oppo_user: Pubkey,
        order_id: u64,
        oppo_order_id: u64,
        order_type: OrderType,
        sell_quantity: u64,
        buy_quantity: u64,
        filled: bool,
        oppo_filled: bool,
    },
    Cancelled{
        order_id: u64,
    }
}

#[derive(Debug, Clone)]
pub enum OrderFailure {
    TooManyEvents{
        who: Pubkey,
        order_id: u64,
        order_type: OrderType,
        sell_quantity: u64,
        buy_quantity: u64,
    },
    OrderHeapFull{
        who: Pubkey,
        order_id: u64,
        order_type: OrderType,
        sell_quantity: u64,
        buy_quantity: u64,
    },
    NoMatch{
        who: Pubkey,
        order_id: u64,
        order_type: OrderType,
        sell_quantity: u64,
        buy_quantity: u64,
    },
    OrderNotFound{
        _order_id: u64,
    },
}

type OrderProcessResult = Vec<Result<OrderSuccess, OrderFailure>>;

#[derive(Debug)]
pub struct MatchingEngine<'a> {
    pub _buy_token: Pubkey,
    pub _sell_token: Pubkey,
    pub buy_queue: &'a mut OrderHeap,
    pub sell_queue: &'a mut OrderHeap,
    pub user_orderbook: &'a mut UserOrderbook,
}

impl<'a> MatchingEngine<'a> {
    pub fn new(buy_token: Pubkey, sell_token: Pubkey, buy_queue: &'a mut OrderHeap, sell_queue: &'a mut OrderHeap, user_orderbook: &'a mut UserOrderbook) -> Self {
        Self {
            _buy_token: buy_token,
            _sell_token: sell_token,
            buy_queue,
            sell_queue,
            user_orderbook,
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
                }));

                Self::process_limit_order(&mut self.buy_queue, &mut self.sell_queue, order_node, &mut result, self.user_orderbook);
            },
            OrderType::Market => {
                result.push(Result::Ok(OrderSuccess::Accepted{
                    order_id: order.id,
                    order_type: order.order_type,
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
        result: &mut OrderProcessResult,
        user_orderbook: &mut UserOrderbook,
    ) { 
        if let Some(sell_order) = sell_queue.get_best_order() {
            let match_available = sell_order.buy_price() >= order.sell_price();
            if result.len() + 2 > MAX_EVENTS  {
                result.push(Result::Err(OrderFailure::TooManyEvents{
                    who: order.owner,
                    order_id: order.id,
                    order_type: OrderType::Limit,
                    sell_quantity: order.sell_quantity,
                    buy_quantity: order.buy_quantity,
                }));
                return; 
            }
            if match_available {
                let completed = Self::order_match(&mut order, sell_queue, result, OrderType::Limit);

                if !completed {
                    Self::process_limit_order(buy_queue, sell_queue, order, result, user_orderbook);
                }
            }else {
                if let Err(_) = buy_queue.add_order(order) {
                    result.push(Result::Err(OrderFailure::OrderHeapFull { who: order.owner, order_id: order.id, order_type: OrderType::Limit, sell_quantity: order.sell_quantity, buy_quantity: order.buy_quantity }));
                }else{
                    user_orderbook.add_order(order.id as u128).unwrap();
                }
            }
        } else {
            if let Err(_) = buy_queue.add_order(order) {
                result.push(Result::Err(OrderFailure::OrderHeapFull { who: order.owner, order_id: order.id, order_type: OrderType::Limit, sell_quantity: order.sell_quantity, buy_quantity: order.buy_quantity }));
            }else{
                user_orderbook.add_order(order.id as u128).unwrap();
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
            let buy_quantity = order.sell_quantity * best_sell_order.buy_price() as u64;
            let oppo_sell_order_mut = sell_queue.get_best_order_mut().unwrap();
            oppo_sell_order_mut.sell_quantity -= buy_quantity;
            oppo_sell_order_mut.buy_quantity -= order.sell_quantity;
            result.push(Result::Ok(OrderSuccess::Filled { 
                who: order.owner,
                oppo_user: oppo_sell_order_mut.owner,
                order_id: order.id,
                oppo_order_id: oppo_sell_order_mut.id,
                order_type: order_type,
                sell_quantity: order.sell_quantity,
                buy_quantity: buy_quantity,
                filled: true,
                oppo_filled: false,  // 对方订单未完全成交
            }));
            return true;
        } else if order.sell_quantity > oppo_buy_quantity {
            let oppo_sell_order_mut = sell_queue.get_best_order_mut().unwrap();
            
            result.push(Result::Ok(OrderSuccess::Filled {
                who: order.owner,
                oppo_user: oppo_sell_order_mut.owner,
                order_id: order.id,
                oppo_order_id: oppo_sell_order_mut.id,
                order_type: order_type,
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
            if let Err(_) = sell_queue.remove_order(opposite_order_id) {
                result.push(Result::Err(OrderFailure::OrderNotFound{_order_id: opposite_order_id}));
            }
            return false;
        } else {
            let oppo_order_mut = sell_queue.get_best_order_mut().unwrap();
            result.push(Result::Ok(OrderSuccess::Filled {
                who: order.owner,
                oppo_user: oppo_order_mut.owner,
                oppo_order_id: oppo_order_mut.id,
                order_id: order.id,
                order_type: order_type,
                sell_quantity: oppo_order_mut.buy_quantity,
                buy_quantity: oppo_order_mut.sell_quantity,
                filled: true,
                oppo_filled: true,  // 双方订单完全成交
            }));
            let opposite_order_id = oppo_order_mut.id;
            if let Err(_) = sell_queue.remove_order(opposite_order_id) {
                result.push(Result::Err(OrderFailure::OrderNotFound{_order_id: opposite_order_id}));
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
        if result.len() + 2 > MAX_EVENTS  {
                result.push(Result::Err(OrderFailure::TooManyEvents{
                    who: order.owner,
                    order_id: order.id,
                    order_type: OrderType::Market,
                    sell_quantity: order.sell_quantity,
                    buy_quantity: order.buy_quantity,
                }));
                return;
        } 
        if let Some(_opposite_order) = sell_queue.get_best_order() {
            let completed = Self::order_match(&mut order, sell_queue, result, OrderType::Market);

            if !completed {
                Self::process_market_order(buy_queue, sell_queue, order, result);
            }
        } else {
            result.push(Result::Err(OrderFailure::NoMatch{
                who: order.owner,
                order_id: order.id,
                order_type: OrderType::Market,
                sell_quantity: order.sell_quantity,
                buy_quantity: order.buy_quantity,
            }));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    fn create_test_order(id: u64, buy_quantity: u64, sell_quantity: u64) -> OrderRequest {
        OrderRequest::new(
            id,
            buy_quantity,
            sell_quantity,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            0,
            OrderType::Limit,
        )
    }

    #[test]
    fn test_orderbook_new() {
        let order_token = Pubkey::new_unique();
        let price_order = Pubkey::new_unique();
        let mut buy_queue = OrderHeap::new();
        let mut sell_queue = OrderHeap::new();
        let mut user_orderbook = UserOrderbook::default();

        let orderbook = MatchingEngine::new(
            order_token,
            price_order,
            &mut buy_queue,
            &mut sell_queue,
            &mut user_orderbook,
        );

        assert_eq!(orderbook._buy_token, order_token);
        assert_eq!(orderbook._sell_token, price_order);
    }

    #[test]
    fn test_process_limit_order_no_match() {
        let order_token = Pubkey::new_unique();
        let price_order = Pubkey::new_unique();
        let mut buy_queue = OrderHeap::new();
        let mut sell_queue = OrderHeap::new();
        let mut user_orderbook = UserOrderbook::default();

        let mut orderbook = MatchingEngine::new(
            order_token,
            price_order,
            &mut buy_queue,
            &mut sell_queue,
            &mut user_orderbook,
        );

        let order = create_test_order(1, 100, 50); // buy 100, sell 50
        let result = orderbook.process_order(order);

        // Should have 1 accepted result
        assert_eq!(result.len(), 1);
        match &result[0] {
            Ok(OrderSuccess::Accepted { order_id, .. }) => {
                assert_eq!(*order_id, 1);
            }
            _ => panic!("Expected Accepted result"),
        }

        // Buy queue should have 1 order
        assert_eq!(buy_queue.next_index, 1);
        // Sell queue should be empty
        assert_eq!(sell_queue.next_index, 0);
    }

    #[test]
    fn test_process_market_order_no_match() {
        let buy_token = Pubkey::new_unique();
        let sell_token = Pubkey::new_unique();
        let mut buy_queue = OrderHeap::new();
        let mut sell_queue = OrderHeap::new();
        let mut user_orderbook = UserOrderbook::default();

        let mut orderbook = MatchingEngine::new(
            buy_token,
            sell_token,
            &mut buy_queue,
            &mut sell_queue,
            &mut user_orderbook,
        );

        let mut market_order = create_test_order(1, 100, 50);
        market_order.order_type = OrderType::Market;
        let owner = market_order.owner;
        let result = orderbook.process_order(market_order);

        // Should have 1 error result (NoMatch)
        assert_eq!(result.len(), 2);
        match &result[0] {
            Err(OrderFailure::NoMatch{
                who,
                order_id,
                order_type,
                sell_quantity,
                buy_quantity,
            }) => {
                assert_eq!(*who, owner);
                assert_eq!(*order_id, 1);
                assert_eq!(*order_type, OrderType::Market);
                assert_eq!(*sell_quantity, 50);
                assert_eq!(*buy_quantity, 100);
            }
            _ => panic!("Expected NoMatch error"),
        }
    }

    #[test]
    fn test_order_node_prices() {
        // Test sell price calculation
        let order = OrderNode::new(
            1,
            100,  // buy_quantity
            50,   // sell_quantity
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            0,
        );
        
        assert_eq!(order.buy_price(), 0.5); // 50/100
        assert_eq!(order.sell_price(), 2.0);  // 100/50
        
        // Test zero quantities
        let zero_order = OrderNode::new(
            2,
            0,
            0,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            0,
        );
        
        assert_eq!(zero_order.buy_price(), 0.0);
        assert_eq!(zero_order.sell_price(), 0.0);
    }

    #[test]
    fn test_order_heap_operations() {
        let mut heap = OrderHeap::new();
        let token1 = Pubkey::new_unique();
        let token2 = Pubkey::new_unique();

        // Add orders
        let order1 = OrderNode::new(
            1,
            100,
            50,
            token1,
            token2,
            Pubkey::new_unique(),
            0,
        );
        println!("order1: {:?}", order1);

        let order2 = OrderNode::new(
            2,
            50,
            50, // Better price than order1 (0.25 vs 0.5)
            token1,
            token2,
            Pubkey::new_unique(),
            0,
        );
        println!("order2: {:?}", order2);
        
        assert!(heap.add_order(order1).is_ok());
        assert!(heap.add_order(order2).is_ok());
        
        // Check that order2 is the best (better price)
        let best = heap.get_best_order().unwrap();
        assert_eq!(best.id, 2);
        
        // Remove order2
        assert!(heap.remove_order(2).is_ok());
        
        // Now order1 should be the best
        let best = heap.get_best_order().unwrap();
        assert_eq!(best.id, 1);
    }

    #[test]
    fn test_limit_order_match_between_buy_and_sell() {
        let token1 = Pubkey::new_unique();
        let token2 = Pubkey::new_unique();
        let mut buy1_queue = OrderHeap::new();
        let mut sell1_queue = OrderHeap::new();
        let mut user_orderbook = UserOrderbook::default();

        // Buy order: wants to buy 100 for 50 (buy_price = 2.0)
        let buy1_order = OrderNode::new(
            1,
            100,
            50,
            token1,
            token2,
            Pubkey::new_unique(),
            0,
        );


        // Add buy order to buy_queue, sell order to sell_queue
        assert!(buy1_queue.add_order(buy1_order.clone()).is_ok());
        // assert!(sell_queue.add_order(sell1_order.clone()).is_ok());

        let mut orderbook = MatchingEngine::new(
            token1,
            token2,
            &mut sell1_queue,
            &mut buy1_queue,
            &mut user_orderbook,
        );

        // Now, process a new buy order that matches the sell order
        let order_req = OrderRequest::new(
            3,
            50,
            100,
            token2,
            token1,
            Pubkey::new_unique(),
            0,
            OrderType::Limit,
        );
        let result = orderbook.process_order(order_req);
        println!("Order Result: {:?}", result);

    }
}