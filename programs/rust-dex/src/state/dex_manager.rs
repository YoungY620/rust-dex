use anchor_lang::prelude::*;

pub const DEX_MANAGER_SEED: &[u8] = b"dex_manager";

#[account]
pub struct DexManager {
    pub sequence_number: u64,
    pub bump: u8,
}

impl DexManager {
    pub fn next_sequence_number(&mut self) -> u64 {
        let Some(next) = self.sequence_number.checked_add(1) else {
            self.sequence_number = 1;
            return 1;
        };
        self.sequence_number = next;
        self.sequence_number
    }
}