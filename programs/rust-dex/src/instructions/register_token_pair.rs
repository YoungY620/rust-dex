use anchor_lang::prelude::*;

pub fn register_token_pair_impl(ctx: Context<RegisterTokenPair>, token1: Pubkey, token2: Pubkey) -> Result<()> {
    msg!("Registering token pair with base: {:?} and quote: {:?}", token1, token2);

    let token_pair: &mut TokenPairAccount = &mut ctx.accounts.token_pair;
    token_pair.base_token = token1;
    token_pair.quote_token = token2;
    token_pair.bump = ctx.bumps.token_pair;

    let opposite_pair: &mut TokenPairAccount = &mut ctx.accounts.opposite_pair;
    opposite_pair.base_token = token2;
    opposite_pair.quote_token = token1;
    opposite_pair.bump = ctx.bumps.opposite_pair;

    Ok(())
}

#[account]
pub struct TokenPairAccount {
    pub base_token: Pubkey,
    pub quote_token: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(token1: Pubkey, token2: Pubkey)]
pub struct RegisterTokenPair<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        init,
        payer = user,
        seeds = [b"token_pair", token1.as_ref(), token2.as_ref()],
        bump,
        space = 8 + 32 + 32 + 1 // Adjust size based on TokenPairAccount struct size
    )]
    pub token_pair: Account<'info, TokenPairAccount>,
    #[account(
        init,
        payer = user,
        seeds = [b"token_pair", token2.as_ref(), token1.as_ref()],
        bump,
        space = 8 + 32 + 32 + 1 // Adjust size based on TokenPairAccount struct size
    )]
    pub opposite_pair: Account<'info, TokenPairAccount>, // Optional, for cross-referencing
}
