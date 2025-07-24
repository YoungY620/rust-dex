use anchor_lang::prelude::*;
use crate::error::ErrorCode;

/// Order side - Buy or Sell
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum Side {
    Bid,  // Buy order
    Ask,  // Sell order
}

impl Side {
    pub fn invert(&self) -> Side {
        match self {
            Side::Bid => Side::Ask,
            Side::Ask => Side::Bid,
        }
    }
}

/// Order type specification
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum OrderType {
    /// Limit order that will be posted to the book if not immediately fillable
    Limit,
    /// Immediate or cancel - fill immediately or cancel
    ImmediateOrCancel,
    /// Fill or kill - must be completely filled or will be cancelled
    FillOrKill,
    /// Post only - will only post to book, never take
    PostOnly,
    /// Market order - fill at best available prices
    Market,
}

/// Self trade behavior when own orders match
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum SelfTradeBehavior {
    /// Cancel the provide order and continue
    CancelProvide,
    /// Cancel the take order and stop
    CancelTake,
    /// Decrement the take order size and continue
    DecrementTake,
}

/// Order parameters for placing an order
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PlaceOrderArgs {
    pub side: Side,
    pub price_lots: i64,
    pub max_base_lots: i64,
    pub max_quote_lots_including_fees: i64,
    pub client_order_id: u64,
    pub order_type: OrderType,
    pub self_trade_behavior: SelfTradeBehavior,
    pub expiry_timestamp: u64,
    pub limit: u8,
}

/// Order struct for internal processing
#[derive(Clone, Debug)]
pub struct Order {
    pub side: Side,
    pub max_base_lots: i64,
    pub max_quote_lots_including_fees: i64,
    pub client_order_id: u64,
    pub time_in_force: u16,
    pub self_trade_behavior: SelfTradeBehavior,
    pub price_lots: i64,
    pub order_type: OrderType,
}

impl Order {
    pub fn new(args: &PlaceOrderArgs) -> Result<Self> {
        require!(args.price_lots > 0, DexError::InvalidPrice);
        require!(args.max_base_lots > 0, DexError::InvalidQuantity);
        require!(args.max_quote_lots_including_fees > 0, DexError::InvalidQuantity);

        let time_in_force = Self::tif_from_expiry(args.expiry_timestamp)?;

        Ok(Order {
            side: args.side,
            max_base_lots: args.max_base_lots,
            max_quote_lots_including_fees: args.max_quote_lots_including_fees,
            client_order_id: args.client_order_id,
            time_in_force,
            self_trade_behavior: args.self_trade_behavior,
            price_lots: args.price_lots,
            order_type: args.order_type,
        })
    }

    /// Convert expiry timestamp to time_in_force
    pub fn tif_from_expiry(expiry_timestamp: u64) -> Result<u16> {
        let now_ts: u64 = Clock::get()?.unix_timestamp.try_into().unwrap();
        if expiry_timestamp != 0 {
            let tif = expiry_timestamp.saturating_sub(now_ts).min(u16::MAX.into());
            require!(tif > 0, DexError::InvalidOrderType);
            Ok(tif as u16)
        } else {
            Ok(0) // Never expire
        }
    }

    pub fn is_post_only(&self) -> bool {
        self.order_type == OrderType::PostOnly
    }

    pub fn is_fill_or_kill(&self) -> bool {
        self.order_type == OrderType::FillOrKill
    }

    pub fn is_immediate_or_cancel(&self) -> bool {
        self.order_type == OrderType::ImmediateOrCancel
    }

    pub fn is_market(&self) -> bool {
        self.order_type == OrderType::Market
    }
}
