
#[macro_export]
/// Generate signed seeds for the market
macro_rules! market_seeds {
    ($market:expr,$mint:expr) => {
        &[b"vault_token_account".as_ref(), &$mint.to_bytes(), &[$market.authority_bump]]
    };
}
