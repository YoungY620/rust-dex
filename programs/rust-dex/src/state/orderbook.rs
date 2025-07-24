use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum Side {
    Bid, // Buy orders
    Ask, // Sell orders
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum OrderType {
    Limit,
    Market,
    PostOnly,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Order {
    /// Unique order ID
    pub order_id: u128,
    
    /// Order owner
    pub owner: Pubkey,
    
    /// Buy or sell
    pub side: Side,
    
    /// Order type
    pub order_type: OrderType,
    
    /// Price in lots (0 for market orders)
    pub price_lots: u64,
    
    /// Original quantity in base lots
    pub max_base_lots: u64,
    
    /// Remaining quantity in base lots
    pub remaining_base_lots: u64,
    
    /// Client order ID for tracking
    pub client_order_id: u64,
    
    /// Timestamp when order was placed
    pub timestamp: u64,
}

/// Simple orderbook implementation using BTreeMap for price levels
#[account]
#[derive(Debug)]
pub struct OrderBook {
    /// Base token mint
    pub base_mint: Pubkey,
    
    /// Quote token mint
    pub quote_mint: Pubkey,
    
    /// Market authority
    pub market_authority: Pubkey,
    
    /// Next order ID
    pub next_order_id: u128,
    
    /// Bump seed
    pub bump: u8,
    
    /// Is initialized
    pub is_initialized: bool,
}

impl OrderBook {
    pub const LEN: usize = 8 + // discriminator
        32 + // base_mint
        32 + // quote_mint
        32 + // market_authority
        16 + // next_order_id
        1 + // bump
        1 + // is_initialized
        1000; // Reserved space for future use

    pub fn new(base_mint: Pubkey, quote_mint: Pubkey, market_authority: Pubkey, bump: u8) -> Self {
        Self {
            base_mint,
            quote_mint,
            market_authority,
            next_order_id: 1,
            bump,
            is_initialized: true,
        }
    }
    
    pub fn generate_order_id(&mut self) -> u128 {
        let id = self.next_order_id;
        self.next_order_id += 1;
        id
    }
}

/// Order storage account - stores individual orders
#[account]
#[derive(Debug)]
pub struct OrderAccount {
    pub order: Order,
    pub bump: u8,
}

impl OrderAccount {
    pub const LEN: usize = 8 + // discriminator
        16 + // order_id
        32 + // owner
        1 + // side
        1 + // order_type
        8 + // price_lots
        8 + // max_base_lots
        8 + // remaining_base_lots
        8 + // client_order_id
        8 + // timestamp
        1; // bump
}

/// Market state for tracking open orders
#[account]
#[derive(Debug)]
pub struct MarketState {
    pub market: Pubkey,
    pub total_orders: u64,
    pub bump: u8,
}

impl MarketState {
    pub const LEN: usize = 8 + // discriminator
        32 + // market
        8 + // total_orders
        1; // bump
}
