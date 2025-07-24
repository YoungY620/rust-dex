use std::collections::{BTreeMap};
use anchor_lang::prelude::*;
use borsh::{BorshDeserialize, BorshSerialize};
use std::fmt::Debug;
use crate::order::{Order, OrderIndex};

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct OrderQueue {
    orders: BTreeMap<u128, Order>,
    // 使用Vec来维护优先级队列，手动排序
    priority_queue: Vec<OrderIndex>
}

impl OrderQueue {
    pub fn new() -> Self {
        Self {
            orders: BTreeMap::new(),
            priority_queue: Vec::new()
        }
    }

    pub fn add_order(&mut self, order: Order) {
        self.priority_queue.push(OrderIndex::new(&order));
        self.orders.insert(order.id, order);
        self.priority_queue.sort_unstable_by(|a, b| b.cmp(a)); // Maintain priority order
    }

    pub fn remove_order(&mut self, order_id: u128) -> Option<Order> {
        if let Some(order) = self.orders.remove(&order_id) {
            self.priority_queue.retain(|idx| idx.id != order_id);
            return Some(order);
        }
        None
    }
    
    pub fn peek_highest_priority(&self) -> Option<&Order> {
        if let Some(highest_id) = self.priority_queue.first() {
            return self.orders.get(&highest_id.id);
        }
        None
    }
    
    pub fn peek_highest_priority_mut(&mut self) -> Option<&mut Order> {
        if let Some(highest_id) = self.priority_queue.first() {
            return self.orders.get_mut(&highest_id.id);
        }
        None
    }

    pub fn pop_highest_priority(&mut self) -> Option<Order> {
        if let Some(_highest_id) = self.priority_queue.get(0) {
            let highest_id = self.priority_queue.swap_remove(0);
            return self.orders.remove(&highest_id.id);
        }
        None
    }

    pub fn is_empty(&self) -> bool {
        self.orders.is_empty()
    }
}