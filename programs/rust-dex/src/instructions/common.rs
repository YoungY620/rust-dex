use crate::state::OrderHeap;
use crate::state::EventList;
use crate::matching_engine::OrderSuccess;
use anchor_lang::prelude::*;

pub fn token_pair_queue_logging(buy_queue: &OrderHeap, sell_queue: & OrderHeap) {
    msg!("queue length: buy={}, sell={}", buy_queue.len(), sell_queue.len());
    for i in 0..buy_queue.len() {
        let order = buy_queue.orders[i];
        msg!("Buy Queue Order {}: buy_token={}, sell_token={}, buy_quantity={}, sell_quantity={}", 
            i, order.buy_token, order.sell_token, order.buy_quantity, order.sell_quantity);
    }
    for i in 0..sell_queue.len() {
        let order = sell_queue.orders[i];
        msg!("Sell Queue Order {}: buy_token={}, sell_token={}, buy_quantity={}, sell_quantity={}", 
            i, order.buy_token, order.sell_token, order.buy_quantity, order.sell_quantity);
    }
}

pub fn convert_to_event_list(event_list: &mut EventList, result: Vec<std::result::Result<OrderSuccess, crate::matching_engine::OrderFailure>>) {
    for res in result {
        match res {
            Ok(success) => {
                match success {
                    OrderSuccess::Filled { who,
                        oppo_user,
                        order_id,
                        oppo_order_id,
                        order_type,
                        sell_quantity,
                        buy_quantity,
                        filled,
                        oppo_filled, 
                    } => {
                        if let Err(e) = event_list.add_event(oppo_user, buy_quantity, sell_quantity, 0, oppo_order_id, oppo_filled as u8, filled as u8) {
                            msg!("Add Event Failed: {:?}", e);
                        }
                    },
                    _ => msg!("Order Success: {:?}", success),
                }
            },
            Err(failure) => {
                match failure {
                    crate::matching_engine::OrderFailure::NoMatch { 
                        who, order_id, order_type, sell_quantity, buy_quantity 
                    }
                    | crate::matching_engine::OrderFailure::TooManyEvents { 
                        who, order_id, order_type, sell_quantity, buy_quantity 
                    }
                    | crate::matching_engine::OrderFailure::OrderHeapFull { 
                        who, order_id, order_type, sell_quantity, buy_quantity 
                    } => {
                        if let Err(e) = event_list.add_event(who, buy_quantity, sell_quantity, 1, 0, 0 , 0) {
                            msg!("Add Event Failed: {:?}", e);
                        }
                    },
                    _ => msg!("Order Failure: {:?}", failure),
                }
            }
        }
    }
}