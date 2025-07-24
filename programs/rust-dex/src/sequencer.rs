use anchor_lang::prelude::*;
use borsh::{BorshSerialize, BorshDeserialize};

pub const SEQUENCER_SIZE: usize = 5; // 减少数组长度避免栈溢出

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct Sequencer {
    pub id_queue: [u64; SEQUENCER_SIZE],  // 固定长度的ID队列
    pub head: usize,                      // 队列头部索引
    pub tail: usize,                      // 队列尾部索引  
    pub count: usize,                     // 队列中ID的数量
    pub is_initialized: bool,             // 是否已初始化
}

impl Sequencer {
    pub fn new() -> Self {
        let mut sequencer = Self {
            id_queue: [0; SEQUENCER_SIZE],
            head: 0,
            tail: 0,
            count: SEQUENCER_SIZE, // 初始时队列是满的
            is_initialized: false,
        };
        
        // 初始化队列为 1 到 n (满队列)
        for i in 0..SEQUENCER_SIZE {
            sequencer.id_queue[i] = (i + 1) as u64;
        }
        
        sequencer.is_initialized = true;
        sequencer
    }
    
    // 弹出头部ID (next_id)
    pub fn pop_next_id(&mut self) -> Option<u64> {
        if self.count == 0 {
            return None; // 队列为空
        }
        
        let id = self.id_queue[self.head];
        self.head = (self.head + 1) % SEQUENCER_SIZE;
        self.count -= 1;
        
        Some(id)
    }
    
    // 回收ID到队列尾部 (recycle_id)
    pub fn recycle_id(&mut self, id: u64) -> bool {
        if self.count >= SEQUENCER_SIZE {
            return false; // 队列已满
        }
        
        self.id_queue[self.tail] = id;
        self.tail = (self.tail + 1) % SEQUENCER_SIZE;
        self.count += 1;
        
        true
    }
    
    // 检查队列是否为空
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }
    
    // 检查队列是否已满
    pub fn is_full(&self) -> bool {
        self.count == SEQUENCER_SIZE
    }
    
    // 获取当前队列中ID的数量
    pub fn get_count(&self) -> usize {
        self.count
    }
    
    // 重置队列到初始状态(满队列，1到n)
    pub fn reset(&mut self) {
        for i in 0..SEQUENCER_SIZE {
            self.id_queue[i] = (i + 1) as u64;
        }
        self.head = 0;
        self.tail = 0;
        self.count = SEQUENCER_SIZE;
    }
}
