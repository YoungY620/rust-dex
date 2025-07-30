use anchor_lang::prelude::Pubkey;


#[macro_export]
/// Generate signed seeds for the market
macro_rules! market_seeds {
    ($market:expr,$mint:expr) => {
        &[b"vault_token_account".as_ref(), &$mint.to_bytes(), &[$market.authority_bump]]
    };
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
#[repr(u8)]
pub enum OrderType {
    Limit,
    Market
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
#[repr(u8)]
pub enum OrderSide {
    Buy,
    Sell
}

#[derive(Debug)]
pub struct OrderRequest {
    pub id: u64,
    pub buy_quantity: u64,
    pub sell_quantity: u64,
    pub buy_token: Pubkey,
    pub sell_token: Pubkey,
    pub owner: Pubkey,
    pub timestamp: i64,
    pub order_type: OrderType,
    pub order_side: OrderSide
}

impl OrderRequest {
    pub fn new(
        id: u64,
        buy_quantity: u64,
        sell_quantity: u64,
        buy_token: Pubkey,
        sell_token: Pubkey,
        owner: Pubkey,
        timestamp: i64,
        order_type: OrderType,
        order_side: OrderSide
    ) -> Self {
        Self {
            id,
            buy_quantity,
            sell_quantity,
            buy_token,
            sell_token,
            owner,
            timestamp,
            order_type,
            order_side
        }
    }
}