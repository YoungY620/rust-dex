use borsh::{BorshDeserialize, BorshSerialize};
use anchor_lang::prelude::*;

use crate::{order::Order, sequencer::*};

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct VecMap {
    data: [Option<Order>; SEQUENCER_SIZE],
    size: usize,
}

impl VecMap {
    pub fn new() -> Self {
        Self {
            data: [const { None }; SEQUENCER_SIZE],
            size: 0,
        }
    }

    pub fn insert(&mut self, key: u64, value: Order) -> Option<Order> {
        let index = (key % SEQUENCER_SIZE as u64) as usize;
        let old_value = self.data[index].take();
        self.data[index] = Some(value);
        if old_value.is_none() {
            self.size += 1;
        }
        old_value
    }

    pub fn get(&self, key: &u64) -> Option<&Order> {
        let index = (key % SEQUENCER_SIZE as u64) as usize;
        self.data[index].as_ref()
    }

    pub fn get_mut(&mut self, key: &u64) -> Option<&mut Order> {
        let index = (key % SEQUENCER_SIZE as u64) as usize;
        self.data[index].as_mut()
    }

    pub fn remove(&mut self, key: &u64) -> Option<Order> {
        let index = (key % SEQUENCER_SIZE as u64) as usize;
        if self.data[index].is_none() {
            return None;
        }
        self.size -= 1;
        self.data[index].take()
    }
    
    pub fn is_empty(&self) -> bool {
        self.size == 0
    }
}
