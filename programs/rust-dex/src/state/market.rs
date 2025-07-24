use anchor_lang::prelude::*;

/// Market account for a trading pair
#[account]
#[derive(Debug)]
pub struct Market {
    /// Authority that can collect fees and update market parameters
    pub market_authority: Pubkey,
    
    /// Base token mint
    pub base_mint: Pubkey,
    
    /// Quote token mint  
    pub quote_mint: Pubkey,
    
    /// Base token vault for holding base tokens
    pub base_vault: Pubkey,
    
    /// Quote token vault for holding quote tokens
    pub quote_vault: Pubkey,
    
    /// Lot sizes for price and quantity
    pub base_lot_size: u64,
    pub quote_lot_size: u64,
    
    /// Fee rates (in basis points, 1 = 0.01%)
    pub maker_fee: i64,
    pub taker_fee: i64,
    
    /// Market sequence number for order IDs
    pub seq_num: u64,
    
    /// Market bump seed
    pub bump: u8,
}

impl Market {
    pub const LEN: usize = 8 + // discriminator
        32 + // market_authority
        32 + // base_mint
        32 + // quote_mint
        32 + // base_vault
        32 + // quote_vault
        8 + // base_lot_size
        8 + // quote_lot_size
        8 + // maker_fee
        8 + // taker_fee
        8 + // seq_num
        1; // bump
}
