use std::cmp::Ordering;

use anchor_lang::prelude::*;
use crate::common::ErrorCode;
use crate::common::ORDER_HEAP_CAPACITY;
use crate::state::OrderNode;
use crate::state::DictTreeMapImpl;
use crate::DictTreeMap;

pub trait OrderHeap {
    fn add_order(&mut self, order: OrderNode) -> Result<()>;
    fn remove_order(&mut self, id: u64) -> Result<OrderNode>;
    fn get_best_order(&self) -> Option<&OrderNode>;
    fn get_best_order_mut(&mut self) -> Option<&mut OrderNode>;
    fn len(&self) -> usize;
    fn get_order_by_id(&self, id: u64) -> Option<&OrderNode>;
}

#[zero_copy]
#[derive(Debug)]
pub struct OrderHeapImpl {
    pub orders: [OrderNode; ORDER_HEAP_CAPACITY],
    pub idx_map: DictTreeMapImpl,
    pub size: u64,
}

impl OrderHeapImpl {

    fn item_gt(&self, a: usize, b: usize) -> bool {
        if a >= self.size as usize || b >= self.size as usize {
            return false;
        }

        return self.orders[a].cmp(&self.orders[b]) == Ordering::Greater;
    }
    
    pub fn new() -> Self {
        OrderHeapImpl {
            orders: [OrderNode::default(); ORDER_HEAP_CAPACITY],
            idx_map: DictTreeMapImpl::new(),
            size: 0,
        }
    }

}

// Removed invalid implementation of Sized trait for OrderHeap
impl OrderHeap for OrderHeapImpl {
    fn len(&self) -> usize {
        self.size as usize
    }

    fn add_order(&mut self, order: OrderNode) -> Result<()> {
        let idx = self.size as usize;
        if idx >= ORDER_HEAP_CAPACITY {
            return Err(ErrorCode::OrderHeapFull.into());
        }
        self.orders[idx] = order;
        self.size += 1;
        self.idx_map.insert(order.id, idx as u64)?;

        let mut i = idx;
        while i > 0 {
            let parent = (i - 1) / 2;
            if self.item_gt(i, parent) {
                // Swap orders to maintain heap property
                self.idx_map.swap(self.orders[i].id, self.orders[parent].id)?;
                self.orders.swap(i, parent);
                i = parent;
            } else {
                break;
            }
        }
        Ok(())
    }

    fn remove_order(&mut self, id: u64) -> Result<OrderNode> {
        let idx = self.idx_map.get(id)?;
        if let Some(index) = idx {
            let index = index as usize;
            let order = self.orders[index];
            let last_order = self.orders[self.size as usize - 1];
            self.orders[index] = last_order;
            self.idx_map.remove(order.id)?;
            self.idx_map.insert(last_order.id, index as u64)?;
            self.size -= 1;

            let mut i = index;

            // Push the node down to maintain the heap property
            while i * 2 + 1 < self.size as usize {
                let left = i * 2 + 1;
                let right = i * 2 + 2;
                let mut largest = i;

                if left < self.size as usize && self.item_gt(left, largest) {
                    largest = left;
                }
                if right < self.size as usize && self.item_gt(right, largest) {
                    largest = right;
                }
                if largest == i {
                    break;
                }

                self.idx_map.swap(self.orders[i].id, self.orders[largest].id)?;
                self.orders.swap(i, largest);
                i = largest;
            }
            Ok(order)
        } else {
            Err(ErrorCode::OrderNotFound.into())
        }
    }

    fn get_best_order(&self) -> Option<&OrderNode> {
        for i in 0..self.size as usize {
            return Some(&self.orders[i]);
        }
        None
    }

    fn get_best_order_mut(&mut self) -> Option<&mut OrderNode> {
        for i in 0..self.size as usize {
            return Some(&mut self.orders[i]);
        }
        None
    }

    fn get_order_by_id(&self, id: u64) -> Option<&OrderNode> {
        self.orders[..self.size as usize].iter().find(|&order| order.id == id)
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_order(id: u64, price: u64) -> OrderNode {
        OrderNode {
            id,
            sell_quantity: price,
            buy_quantity: 1,
            ..OrderNode::default()
        }
    }

    #[test]
    fn test_add_and_get_best_order() {
        let mut heap = OrderHeapImpl::new();
        let order1 = make_order(1, 100);
        let order2 = make_order(2, 200);
        heap.add_order(order1).unwrap();
        heap.add_order(order2).unwrap();
        let best = heap.get_best_order().unwrap();
        assert_eq!(best.id, 2);
    }

    #[test]
    fn test_remove_order_root() {
        let mut heap = OrderHeapImpl::new();
        let order1 = make_order(1, 100);
        let order2 = make_order(2, 200);
        let order3 = make_order(3, 150);
        heap.add_order(order1).unwrap();
        heap.add_order(order2).unwrap();
        heap.add_order(order3).unwrap();

        // Remove the root (best order)
        let removed = heap.remove_order(2).unwrap();
        assert_eq!(removed.id, 2);
        // The new best should be order3 (price 150)
        let best = heap.get_best_order().unwrap();
        assert_eq!(best.id, 3);
    }

    #[test]
    fn test_remove_order_leaf() {
        let mut heap = OrderHeapImpl::new();
        let order1 = make_order(1, 100);
        let order2 = make_order(2, 200);
        let order3 = make_order(3, 150);
        heap.add_order(order1).unwrap();
        heap.add_order(order2).unwrap();
        heap.add_order(order3).unwrap();

        // Remove a leaf node
        let removed = heap.remove_order(1).unwrap();
        assert_eq!(removed.id, 1);
        // The best should still be order2
        let best = heap.get_best_order().unwrap();
        assert_eq!(best.id, 2);
    }

    #[test]
    fn test_remove_order_middle() {
        let mut heap = OrderHeapImpl::new();
        let order1 = make_order(1, 100);
        let order2 = make_order(2, 200);
        let order3 = make_order(3, 150);
        let order4 = make_order(4, 120);
        heap.add_order(order1).unwrap();
        heap.add_order(order2).unwrap();
        heap.add_order(order3).unwrap();
        heap.add_order(order4).unwrap();

        // Remove a middle node
        let removed = heap.remove_order(3).unwrap();
        assert_eq!(removed.id, 3);
        // The best should still be order2
        let best = heap.get_best_order().unwrap();
        assert_eq!(best.id, 2);
        // The heap should still contain order1 and order4
        assert!(heap.get_order_by_id(1).is_some());
        assert!(heap.get_order_by_id(4).is_some());
    }

    #[test]
    fn test_remove_nonexistent_order() {
        let mut heap = OrderHeapImpl::new();
        let order1 = make_order(1, 100);
        heap.add_order(order1).unwrap();
        let result = heap.remove_order(999);
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_all_orders() {
        let mut heap = OrderHeapImpl::new();
        let order1 = make_order(1, 100);
        let order2 = make_order(2, 200);
        heap.add_order(order1).unwrap();
        heap.add_order(order2).unwrap();

        heap.remove_order(2).unwrap();
        heap.remove_order(1).unwrap();
        assert!(heap.get_best_order().is_none());
        assert_eq!(heap.len(), 0);
    }

}
