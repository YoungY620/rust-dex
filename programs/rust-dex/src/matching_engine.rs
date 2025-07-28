use std::{char::MAX, fmt::Debug, result::Result};

use anchor_lang::prelude::{Clock, Pubkey, SolanaSysvar};

use crate::{common::{OrderRequest, OrderType, MAX_EVENTS}, state::{OrderHeap, OrderNode}};


#[derive(Debug, Clone)]
pub enum OrderSuccess {
    Accepted{
        order_id: u64,
        order_type: OrderType,
    },
    Filled{
        who: Pubkey,
        order_id: u64,
        order_type: OrderType,
        sell_quantity: u64,
        buy_quantity: u64,
    },
    PartialFilled{
        who: Pubkey,
        order_id: u64,
        order_type: OrderType,
        sell_quantity: u64,
        buy_quantity: u64,
    },
    Cancelled{
        order_id: u64,
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
pub struct MatchingEngine<'a> {
    pub buy_token: Pubkey,
    pub sell_order: Pubkey,
    pub buy_queue: &'a mut OrderHeap,
    pub sell_queue: &'a mut OrderHeap,
}

impl<'a> MatchingEngine<'a> {
    pub fn new(order_token: Pubkey, price_order: Pubkey, buy_queue: &'a mut OrderHeap, sell_queue: &'a mut OrderHeap) -> Self {
        Self {
            buy_token: order_token,
            sell_order: price_order,
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
                }));

                Self::process_limit_order(&mut self.buy_queue, &mut self.sell_queue, order_node, &mut result);
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
        result: &mut OrderProcessResult
    ) { 
        if let Some(sell_order) = sell_queue.get_best_order() {
            let match_available = sell_order.buy_price() >= order.sell_price();
            if result.len() + 2 > MAX_EVENTS  {
                result.push(Result::Err(OrderFailed::TooManyEvents(result.len() as u64)));
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
            let buy_quantity = order.sell_quantity * best_sell_order.buy_price() as u64;
            result.push(Result::Ok(OrderSuccess::Filled { 
                who: order.owner,
                order_id: order.id, 
                order_type: order_type, 
                sell_quantity: order.sell_quantity,
                buy_quantity: buy_quantity,
            }));
            let oppo_sell_order_mut = sell_queue.get_best_order_mut().unwrap();
            oppo_sell_order_mut.sell_quantity -= buy_quantity;
            oppo_sell_order_mut.buy_quantity -= order.sell_quantity;
            result.push(Result::Ok(OrderSuccess::PartialFilled {
                who: oppo_sell_order_mut.owner,
                order_id: oppo_sell_order_mut.id,
                order_type: OrderType::Limit,
                sell_quantity: buy_quantity,
                buy_quantity: order.sell_quantity,
            }));
            return true;
        } else if order.sell_quantity > oppo_buy_quantity {
            let oppo_sell_order_mut = sell_queue.get_best_order_mut().unwrap();
            
            result.push(Result::Ok(OrderSuccess::PartialFilled {
                who: order.owner,
                order_id: order.id,
                order_type: order_type,
                sell_quantity: oppo_sell_order_mut.buy_quantity,
                buy_quantity: oppo_sell_order_mut.sell_quantity,
            }));
            order.sell_quantity -= oppo_sell_order_mut.buy_quantity;
            if order_type == OrderType::Limit {
                order.buy_quantity -= oppo_sell_order_mut.sell_quantity;
            }
            result.push(Result::Ok(OrderSuccess::Filled {
                who: oppo_sell_order_mut.owner,
                order_id: oppo_sell_order_mut.id,
                order_type: OrderType::Limit,
                sell_quantity: oppo_sell_order_mut.sell_quantity,
                buy_quantity: oppo_sell_order_mut.buy_quantity,
            }));
            let opposite_order_id = oppo_sell_order_mut.id;
            if let Err(_) = sell_queue.remove_order(opposite_order_id) {
                result.push(Result::Err(OrderFailed::OrderNotFound(opposite_order_id)));
            }
            return false;
        } else {
            let oppo_order_mut = sell_queue.get_best_order_mut().unwrap();
            result.push(Result::Ok(OrderSuccess::Filled {
                who: order.owner,
                order_id: order.id,
                order_type: order_type,
                sell_quantity: oppo_order_mut.buy_quantity,
                buy_quantity: oppo_order_mut.sell_quantity,
            }));
            result.push(Result::Ok(OrderSuccess::Filled {
                who: oppo_order_mut.owner,
                order_id: oppo_order_mut.id,
                order_type: OrderType::Limit,
                sell_quantity: oppo_order_mut.sell_quantity,
                buy_quantity: oppo_order_mut.buy_quantity,
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
        if result.len() + 2 > MAX_EVENTS  {
                result.push(Result::Err(OrderFailed::TooManyEvents(result.len() as u64)));
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

        let orderbook = MatchingEngine::new(
            order_token,
            price_order,
            &mut buy_queue,
            &mut sell_queue,
        );

        assert_eq!(orderbook.buy_token, order_token);
        assert_eq!(orderbook.sell_order, price_order);
    }

    #[test]
    fn test_process_limit_order_no_match() {
        let order_token = Pubkey::new_unique();
        let price_order = Pubkey::new_unique();
        let mut buy_queue = OrderHeap::new();
        let mut sell_queue = OrderHeap::new();

        let mut orderbook = MatchingEngine::new(
            order_token,
            price_order,
            &mut buy_queue,
            &mut sell_queue,
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
        let order_token = Pubkey::new_unique();
        let price_order = Pubkey::new_unique();
        let mut buy_queue = OrderHeap::new();
        let mut sell_queue = OrderHeap::new();

        let mut orderbook = MatchingEngine::new(
            order_token,
            price_order,
            &mut buy_queue,
            &mut sell_queue,
        );

        let mut market_order = create_test_order(1, 100, 50);
        market_order.order_type = OrderType::Market;
        let result = orderbook.process_order(market_order);

        // Should have 1 error result (NoMatch)
        assert_eq!(result.len(), 2);
        match &result[0] {
            Err(OrderFailed::NoMatch(order_id)) => {
                assert_eq!(*order_id, 1);
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