use std::{collections::{BinaryHeap, HashMap}, fmt::Debug};

use anchor_lang::prelude::{borsh::{BorshDeserialize, BorshSerialize}, *};

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct OrderBook {
    pub order_token: Pubkey,
    pub price_order: Pubkey,
    pub buy_queue: OrderQueue<Order>,
    pub sel_queue: OrderQueue<Order>
}

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct OrderQueue<O> 
where 
    O: Debug + Clone + BorshDeserialize + BorshSerialize, 
{
    orders: HashMap<u64, O>,
    priority_queue: Option<BinaryHeap<u64>>
}


#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct Order {

}