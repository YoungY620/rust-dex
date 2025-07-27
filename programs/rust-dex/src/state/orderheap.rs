use anchor_lang::prelude::*;
use crate::common::ErrorCode;
use crate::common::ORDER_HEAP_CAPACITY;

#[zero_copy]
#[derive(Debug)]
pub struct OrderNode {
    pub id: u64,
    pub base_quantity: u64,
    pub quote_quantity: u64,
    pub order_type: u64, // 0 for buy, 1 for sell
    pub base_token: Pubkey,
    pub quote_token: Pubkey,
    pub priority: u64, // Priority for the order
}

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
            orders: [OrderNode { 
                id: 0, 
                base_quantity: 0, 
                quote_quantity: 0, 
                order_type: 0, 
                base_token: Pubkey::default(), 
                quote_token: Pubkey::default(),
                priority: 0, 
            }; ORDER_HEAP_CAPACITY],
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
        while i > 0 && self.orders[i].priority > self.orders[i - 1].priority {
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

    pub fn get_order_by_id(&self, id: u64) -> Option<&OrderNode> {
        self.orders[..self.next_index as usize].iter().find(|&order| order.id == id)
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_order_heap() {
        let heap = OrderHeap::new();
        assert_eq!(heap.next_index, 0);
        assert_eq!(heap.orders.len(), ORDER_HEAP_CAPACITY);
        assert_eq!(heap.bitmap.len(), ORDER_HEAP_CAPACITY);
        
        // Check that all bitmap entries are 0 (inactive)
        for i in 0..ORDER_HEAP_CAPACITY {
            assert_eq!(heap.bitmap[i], 0);
        }
    }

    #[test]
    fn test_add_order() {
        let mut heap = OrderHeap::new();
        
        let order = OrderNode {
            id: 1,
            base_quantity: 100,
            quote_quantity: 200,
            order_type: 0,
            base_token: Pubkey::new_unique(),
            quote_token: Pubkey::new_unique(),
            priority: 10,
        };

        let result = heap.add_order(order);
        assert!(result.is_ok());
        assert_eq!(heap.next_index, 1);
        assert_eq!(heap.bitmap[0], 1);
        assert_eq!(heap.orders[0].id, 1);
        assert_eq!(heap.orders[0].priority, 10);
    }

    #[test]
    fn test_add_multiple_orders_with_priority() {
        let mut heap = OrderHeap::new();
        
        // Add order with lower priority
        let order1 = OrderNode {
            id: 1,
            base_quantity: 100,
            quote_quantity: 200,
            order_type: 0,
            base_token: Pubkey::new_unique(),
            quote_token: Pubkey::new_unique(),
            priority: 5,
        };
        heap.add_order(order1).unwrap();

        // Add order with higher priority
        let order2 = OrderNode {
            id: 2,
            base_quantity: 150,
            quote_quantity: 250,
            order_type: 1,
            base_token: Pubkey::new_unique(),
            quote_token: Pubkey::new_unique(),
            priority: 10,
        };
        heap.add_order(order2).unwrap();

        // Higher priority order should be first
        assert_eq!(heap.get_best_order().unwrap().id, 2);
        assert_eq!(heap.next_index, 2);
    }

    #[test]
    fn test_order_heap_full() {
        let mut heap = OrderHeap::new();
        
        // Fill the heap to capacity (16 as per comment in code)
        for i in 0..16 {
            let order = OrderNode {
                id: i as u64,
                base_quantity: 100,
                quote_quantity: 200,
                order_type: 0,
                base_token: Pubkey::new_unique(),
                quote_token: Pubkey::new_unique(),
                priority: i as u64,
            };
            
            assert!(heap.add_order(order).is_ok());
        }
        
        // Try to add one more order, should fail
        let order = OrderNode {
            id: 99,
            base_quantity: 100,
            quote_quantity: 200,
            order_type: 0,
            base_token: Pubkey::new_unique(),
            quote_token: Pubkey::new_unique(),
            priority: 50,
        };
        
        assert_eq!(heap.add_order(order).unwrap_err(), ErrorCode::OrderHeapFull.into());
    }

    #[test]
    fn test_remove_order() {
        let mut heap = OrderHeap::new();
        
        let order = OrderNode {
            id: 1,
            base_quantity: 100,
            quote_quantity: 200,
            order_type: 0,
            base_token: Pubkey::new_unique(),
            quote_token: Pubkey::new_unique(),
            priority: 10,
        };
        
        heap.add_order(order).unwrap();
        assert_eq!(heap.next_index, 1);
        assert_eq!(heap.bitmap[0], 1);
        
        let removed_order = heap.remove_order(1).unwrap();
        assert_eq!(removed_order.id, 1);
        assert_eq!(heap.next_index, 0);
        assert_eq!(heap.bitmap[0], 0);
    }

    #[test]
    fn test_remove_order_not_found() {
        let mut heap = OrderHeap::new();
        
        let result = heap.remove_order(99);
        assert_eq!(result.unwrap_err(), ErrorCode::OrderNotFound.into());
    }

    #[test]
    fn test_get_best_order() {
        let mut heap = OrderHeap::new();
        
        // Initially should return None
        assert!(heap.get_best_order().is_none());
        
        let order = OrderNode {
            id: 1,
            base_quantity: 100,
            quote_quantity: 200,
            order_type: 0,
            base_token: Pubkey::new_unique(),
            quote_token: Pubkey::new_unique(),
            priority: 10,
        };
        
        heap.add_order(order).unwrap();
        assert_eq!(heap.get_best_order().unwrap().id, 1);
    }

    #[test]
    fn test_get_order_by_id() {
        let mut heap = OrderHeap::new();
        
        // Should return None for non-existent order
        assert!(heap.get_order_by_id(1).is_none());
        
        let order = OrderNode {
            id: 42,
            base_quantity: 100,
            quote_quantity: 200,
            order_type: 0,
            base_token: Pubkey::new_unique(),
            quote_token: Pubkey::new_unique(),
            priority: 10,
        };
        
        heap.add_order(order).unwrap();
        assert_eq!(heap.get_order_by_id(42).unwrap().id, 42);
        assert!(heap.get_order_by_id(99).is_none());
    }
}