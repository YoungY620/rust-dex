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

// Removed invalid implementation of Sized trait for OrderHeap
impl OrderHeap {
    pub fn len(&self) -> usize {
        self.next_index as usize
    }

    fn item_gt(&self, a: usize, b: usize) -> bool {
        if a >= self.next_index as usize || b >= self.next_index as usize {
            return false;
        }

        if self.bitmap[a] != self.bitmap[b] {
            // If one is active and the other is not, the active one is greaters
            return self.bitmap[a] > self.bitmap[b];
        }
        return self.orders[a].cmp(&self.orders[b]) == Ordering::Greater;
    }

    pub fn new() -> Self {
        OrderHeap {
            orders: [OrderNode::default(); ORDER_HEAP_CAPACITY],
            bitmap: [0; ORDER_HEAP_CAPACITY],
            next_index: 0,
        }
    }
    pub fn add_order(&mut self, order: OrderNode) -> Result<()> {
        let idx = self.next_index as usize;
        if idx >= ORDER_HEAP_CAPACITY {
            return Err(ErrorCode::OrderHeapFull.into());
        }
        self.orders[idx] = order;
        self.bitmap[idx] = 1; // Set bit for active order
        let mut i = idx;
        while i > 0 {
            let parent = (i - 1) / 2;
            if self.item_gt(i, parent) {
            // Swap orders to maintain heap property
            self.orders.swap(i, parent);
            self.bitmap.swap(i, parent);
            i = parent;
            } else {
            break;
            }
        }
        self.next_index += 1;
        while self.bitmap[self.next_index as usize - 1] == 0 {
            self.next_index -= 1; // Adjust next_index to skip unused slots
        }
        Ok(())
    }

    pub fn remove_order(&mut self, id: u64) -> Result<OrderNode> {
        let idx = (0..self.next_index as usize).find(|&i| self.orders[i].id == id);
        msg!("Removing order with id: {}", id);
        if let Some(index) = idx {
            let order = self.orders[index];
            self.bitmap[index] = 0; // Mark the node as inactive
            let mut i = index;
            msg!("Removing order at index: {}", i);

            // Push the node down to maintain the heap property
            while i * 2 + 1 < self.next_index as usize {
                let left = i * 2 + 1;
                let right = i * 2 + 2;
                let mut largest = i;

                if left < self.next_index as usize && self.item_gt(left, largest) {
                    largest = left;
                }
                if right < self.next_index as usize && self.item_gt(right, largest) {
                    largest = right;
                }
                if largest == i {
                    break;
                }

                self.orders.swap(i, largest);
                self.bitmap.swap(i, largest);
                i = largest;
            }
            self.next_index -= 1;
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

