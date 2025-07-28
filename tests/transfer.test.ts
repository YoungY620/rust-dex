import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RustDex } from "../target/types/rust_dex";
import { mintTo } from "@solana/spl-token";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";
import {
  createFundedUser,
  createTokenMint,
  createUserTokenAccount,
  registerVaultTokenLedger,
  registerUser,
  registerUserTokenLedger,
  depositTokens
} from "./test-utils";

describe("rust-dex: transfer", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.rustDex as Program<RustDex>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  let mintAuthority: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  let vault: Keypair;
  let mint: PublicKey;
  let user1TokenAccount: PublicKey;
  let user2TokenAccount: PublicKey;
  let vaultTokenAccount: PublicKey;
  let vaultTokenLedgerPda: PublicKey;
  let user1TokenLedgerPda: PublicKey;
  let user2TokenLedgerPda: PublicKey;

  const INITIAL_AMOUNT = 1000 * 10 ** 9;
  const DEPOSIT_AMOUNT = 500 * 10 ** 9;
  const TRANSFER_AMOUNT = 100 * 10 ** 9;

  before(async () => {
    mintAuthority = await createFundedUser(provider);
    user1 = await createFundedUser(provider);
    user2 = await createFundedUser(provider);
    vault = await createFundedUser(provider);

    mint = await createTokenMint(provider.connection, mintAuthority);
    user1TokenAccount = await createUserTokenAccount(provider.connection, user1, mint);
    user2TokenAccount = await createUserTokenAccount(provider.connection, user2, mint);

    // Mint tokens
    await mintTo(provider.connection, mintAuthority, mint, user1TokenAccount, mintAuthority, INITIAL_AMOUNT);
    await mintTo(provider.connection, mintAuthority, mint, user2TokenAccount, mintAuthority, INITIAL_AMOUNT);

    // Register vault and users
    const vaultResult = await registerVaultTokenLedger(program, vault, mint);
    vaultTokenAccount = vaultResult.vaultTokenAccount;
    vaultTokenLedgerPda = vaultResult.vaultTokenLedgerPda;

    await registerUser(program, user1);
    await registerUser(program, user2);

    user1TokenLedgerPda = await registerUserTokenLedger(program, user1, mint, user1TokenAccount);
    user2TokenLedgerPda = await registerUserTokenLedger(program, user2, mint, user2TokenAccount);

    // Deposit tokens
    await depositTokens(program, user1, mint, DEPOSIT_AMOUNT, user1TokenAccount, vaultTokenAccount, vaultTokenLedgerPda, user1TokenLedgerPda);
    await depositTokens(program, user2, mint, DEPOSIT_AMOUNT, user2TokenAccount, vaultTokenAccount, vaultTokenLedgerPda, user2TokenLedgerPda);
  });

  it("Should transfer tokens between users", async () => {
    // 这里可以添加用户间转账的测试
    // 目前只是一个占位符，因为需要实现transfer指令
    console.log("Transfer functionality would be tested here");
    
    // 获取转账前的余额
    const user1BalanceBefore = await program.account.individualTokenLedgerAccount.fetch(user1TokenLedgerPda);
    const user2BalanceBefore = await program.account.individualTokenLedgerAccount.fetch(user2TokenLedgerPda);
    
    console.log("Balances before transfer:", {
      user1: user1BalanceBefore.availableBalance.toString(),
      user2: user2BalanceBefore.availableBalance.toString()
    });

    // 实际的转账逻辑需要在实现transfer指令后添加
    expect(user1BalanceBefore.availableBalance.toString()).to.equal(DEPOSIT_AMOUNT.toString());
    expect(user2BalanceBefore.availableBalance.toString()).to.equal(DEPOSIT_AMOUNT.toString());
  });
});
