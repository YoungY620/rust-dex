use anchor_lang::prelude::*;
use borsh::{BorshDeserialize, BorshSerialize};
use std::fmt::Debug;
use crate::order::{Order, OrderIndex};
use crate::map::VecMap;
use crate::sequencer::SEQUENCER_SIZE;

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct OrderQueue {
    orders: VecMap,
    priority_queue: [OrderIndex; SEQUENCER_SIZE],
    queue_count: usize, // 记录队列中有效元素的数量
}

impl OrderQueue {
    pub fn new() -> Self {
        Self {
            orders: VecMap::new(),
            priority_queue: [OrderIndex::default(); SEQUENCER_SIZE],
            queue_count: 0,
        }
    }

    pub fn add_order(&mut self, order: Order) -> bool {
        if self.queue_count >= SEQUENCER_SIZE {
            return false; // Priority queue is full
        }
        
        let order_index = OrderIndex::new(&order);
        
        // 插入到队列中，保持优先级顺序
        let mut insert_pos = self.queue_count;
        for i in 0..self.queue_count {
            if order_index < self.priority_queue[i] {
                insert_pos = i;
                break;
            }
        }
        
        // 向后移动元素为新元素腾出空间
        for i in (insert_pos..self.queue_count).rev() {
            self.priority_queue[i + 1] = self.priority_queue[i];
        }
        
        // 插入新元素
        self.priority_queue[insert_pos] = order_index;
        self.queue_count += 1;
        
        // 添加到orders map
        self.orders.insert(order.id, order);
        
        true
    }

    pub fn remove_order(&mut self, order_id: u64) -> Option<Order> {
        if let Some(order) = self.orders.remove(&order_id) {
            // 从priority queue中移除
            for i in 0..self.queue_count {
                if self.priority_queue[i].id == order_id {
                    // 向前移动后续元素
                    for j in i..self.queue_count - 1 {
                        self.priority_queue[j] = self.priority_queue[j + 1];
                    }
                    self.queue_count -= 1;
                    break;
                }
            }
            return Some(order);
        }
        None
    }
    
    pub fn peek_highest_priority(&self) -> Option<&Order> {
        if self.queue_count > 0 {
            let highest_id = self.priority_queue[0].id;
            return self.orders.get(&highest_id);
        }
        None
    }
    
    pub fn peek_highest_priority_mut(&mut self) -> Option<&mut Order> {
        if self.queue_count > 0 {
            let highest_id = self.priority_queue[0].id;
            return self.orders.get_mut(&highest_id);
        }
        None
    }

    pub fn pop_highest_priority(&mut self) -> Option<Order> {
        if self.queue_count > 0 {
            let highest_id = self.priority_queue[0].id;
            
            // 向前移动后续元素
            for i in 0..self.queue_count - 1 {
                self.priority_queue[i] = self.priority_queue[i + 1];
            }
            self.queue_count -= 1;
            
            return self.orders.remove(&highest_id);
        }
        None
    }

    pub fn is_empty(&self) -> bool {
        self.queue_count == 0
    }
    
    pub fn is_full(&self) -> bool {
        self.queue_count >= SEQUENCER_SIZE
    }
    
    pub fn get_count(&self) -> usize {
        self.queue_count
    }
}