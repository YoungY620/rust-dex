use std::cmp::Ordering;

use anchor_lang::prelude::*;
use crate::common::ErrorCode;
use crate::common::ORDER_HEAP_CAPACITY;
use crate::state::OrderNode;


#[zero_copy]
#[derive(Debug)]
pub struct OrderHeap {
    pub orders: [OrderNode; ORDER_HEAP_CAPACITY], // 减少到16个订单
    pub bitmap: [u8; ORDER_HEAP_CAPACITY],
    pub next_index: u64,
}

impl OrderHeap {
    pub fn new() -> Self {
        OrderHeap {
            orders: [OrderNode::default(); ORDER_HEAP_CAPACITY],
            bitmap: [0; ORDER_HEAP_CAPACITY],
            next_index: 0,
        }
    }
    pub fn add_order(&mut self, order: OrderNode) -> Result<()> {
        let idx = self.next_index as usize;
        if idx >= 16 {
            return Err(ErrorCode::OrderHeapFull.into());
        }
        self.orders[idx] = order;
        self.bitmap[idx] = 1; // Set bit for active order
        let mut i = idx;
        while i > 0 && self.orders[i].cmp(&self.orders[i - 1]) == Ordering::Greater {
            // Swap orders to maintain priority
            self.orders.swap(i, i - 1);
            self.bitmap.swap(i , i - 1);
            i -= 1;
        }
        self.next_index += 1;
        Ok(())
    }

    pub fn remove_order(&mut self, id: u64) -> Result<OrderNode> {
        let idx = (0..self.next_index as usize).find(|&i| self.orders[i].id == id);
        if let Some(index) = idx {
            let order = self.orders[index];
            for i in index..(self.next_index as usize - 1) {
                self.orders[i] = self.orders[i + 1];
                self.bitmap[i] = self.bitmap[i + 1];
            }
            self.next_index -= 1;
            let last = self.next_index as usize;
            self.bitmap[last] = 0; // Clear last bitmap bit
            Ok(order)
        } else {
            Err(ErrorCode::OrderNotFound.into())
        }
    }

    pub fn get_best_order(&self) -> Option<&OrderNode> {
        for i in 0..self.next_index as usize {
            if self.bitmap[i] == 1 {
                return Some(&self.orders[i]);
            }
        }
        None
    }

    pub fn get_best_order_mut(&mut self) -> Option<&mut OrderNode> {
        for i in 0..self.next_index as usize {
            if self.bitmap[i] == 1 {
                return Some(&mut self.orders[i]);
            }
        }
        None
    }

    pub fn get_order_by_id(&self, id: u64) -> Option<&OrderNode> {
        self.orders[..self.next_index as usize].iter().find(|&order| order.id == id)
    }

}

