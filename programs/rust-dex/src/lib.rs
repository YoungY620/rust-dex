use std::{collections::HashMap};

use anchor_lang::prelude::{borsh::{BorshDeserialize}, *};

mod orderbook;

declare_id!("DxDE9zuCpkBiuJhAYo5een6xMqF34J3jZuRYCodLhVnw");

#[account]
struct State {
    pub orderbooks: HashMap<String, orderbook::OrderBook>
}

#[program]
pub mod rust_dex {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
