use anchor_lang::prelude::*;

pub fn register_user_impl(ctx: Context<RegisterUser>) -> Result<()> {
    msg!("Registering user with key: {:?}", ctx.accounts.user.key());
    let individual_ledger: &mut IndividualLedgerAccount = &mut ctx.accounts.individual_ledger;
    let user_order_book: &mut UserOrderbook = &mut ctx.accounts.user_order_book;

    individual_ledger.tokens = [Pubkey::default(); MAX_TOKEN_MINTS];
    individual_ledger.bitmap = [0; MAX_TOKEN_MINTS];
    individual_ledger.next_index = 0;
    individual_ledger.bump = ctx.bumps.individual_ledger;

    user_order_book.orders = [0; MAX_TOKEN_MINTS];
    user_order_book.bitmap = [0; MAX_TOKEN_MINTS];
    user_order_book.next_index = 0;
    user_order_book.bump = ctx.bumps.user_order_book;
    Ok(())
}


pub const MAX_TOKEN_MINTS: usize = 32;
pub const MAX_PERSONAL_ORDERS: usize = 32;

#[account]
pub struct IndividualLedgerAccount {
    pub tokens: [Pubkey; MAX_TOKEN_MINTS],
    pub next_index: u16,
    pub bitmap: [u8; MAX_TOKEN_MINTS],
    pub bump: u8,
}

#[account]
pub struct UserOrderbook {
    pub orders: [u128; MAX_TOKEN_MINTS],
    pub next_index: u16,
    pub bitmap: [u8; MAX_TOKEN_MINTS],
    pub bump: u8,
}

#[derive(Accounts)]
pub struct RegisterUser<'info> {
    #[account(
        init,
        payer = user,
        seeds = [b"user_ledger", user.key().as_ref()],
        bump,
        space = 8 + MAX_TOKEN_MINTS * 32 + MAX_TOKEN_MINTS + 2 + 1 // Adjust size based on IndividualLedgerAccount struct size
    )]
    pub individual_ledger: Box<Account<'info, IndividualLedgerAccount>>,
    #[account(
        init,
        payer = user,
        seeds = [b"user_orderbook", user.key().as_ref()],
        bump,
        space = 8 + MAX_PERSONAL_ORDERS * 16 + MAX_PERSONAL_ORDERS + 2 + 1 // Adjust size based on Order struct size
    )]
    pub user_order_book: Box<Account<'info, UserOrderbook>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}