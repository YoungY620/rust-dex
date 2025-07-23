use anchor_lang::prelude::*;

declare_id!("DxDE9zuCpkBiuJhAYo5een6xMqF34J3jZuRYCodLhVnw");

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
