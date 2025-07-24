// Utility functions for the DEX

use anchor_lang::prelude::*;

/// Convert price from float to lots representation
pub fn price_to_lots(price: f64, quote_lot_size: u64) -> u64 {
    (price * quote_lot_size as f64) as u64
}

/// Convert price from lots to float representation  
pub fn lots_to_price(price_lots: u64, quote_lot_size: u64) -> f64 {
    price_lots as f64 / quote_lot_size as f64
}

/// Convert quantity to base lots
pub fn quantity_to_base_lots(quantity: u64, base_lot_size: u64) -> u64 {
    quantity / base_lot_size
}

/// Convert base lots to quantity
pub fn base_lots_to_quantity(base_lots: u64, base_lot_size: u64) -> u64 {
    base_lots * base_lot_size
}
