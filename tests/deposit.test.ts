import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RustDex } from "../target/types/rust_dex";
import { mintTo } from "@solana/spl-token";
import { PublicKey, Keypair, SendTransactionError } from "@solana/web3.js";
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

describe("rust-dex: deposit", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.rustDex as Program<RustDex>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  let mint: PublicKey;
  let user: Keypair;
  let vault: Keypair;
  let mintAuthority: Keypair;
  let userTokenAccount: PublicKey;
  let vaultTokenAccount: PublicKey;
  let vaultTokenLedgerPda: PublicKey;
  let userTokenLedgerPda: PublicKey;
  const depositAmount = 100;

  before(async () => {
    mintAuthority = await createFundedUser(provider);
    user = await createFundedUser(provider);
    vault = await createFundedUser(provider);

    mint = await createTokenMint(provider.connection, mintAuthority);
    userTokenAccount = await createUserTokenAccount(provider.connection, user, mint);
    
    const vaultResult = await registerVaultTokenLedger(program, vault, mint);
    vaultTokenAccount = vaultResult.vaultTokenAccount;
    vaultTokenLedgerPda = vaultResult.vaultTokenLedgerPda;
    
    await registerUser(program, user);
    
    userTokenLedgerPda = await registerUserTokenLedger(
      program,
      user,
      mint,
      userTokenAccount
    );
  });

  it("Should deposit tokens correctly", async () => {
    const amount = depositAmount * 10 ** 9;
    await mintTo(
      provider.connection,
      mintAuthority,
      mint,
      userTokenAccount,
      mintAuthority,
      amount
    );

    const beforeUser = await provider.connection.getTokenAccountBalance(userTokenAccount);
    const beforeVault = await provider.connection.getTokenAccountBalance(vaultTokenAccount);

    try {
      await depositTokens(
        program,
        user,
        mint,
        amount,
        userTokenAccount,
        vaultTokenAccount,
        vaultTokenLedgerPda,
        userTokenLedgerPda
      );
    } catch (err: any) {
      if (err instanceof SendTransactionError) {
        console.error("Deposit transaction failed, logs:", err.logs);
      }
      throw err;
    }

    const afterUser = await provider.connection.getTokenAccountBalance(userTokenAccount);
    const afterVault = await provider.connection.getTokenAccountBalance(vaultTokenAccount);

    expect(BigInt(afterUser.value.amount)).to.equal(BigInt(beforeUser.value.amount) - BigInt(amount));
    expect(BigInt(afterVault.value.amount)).to.equal(BigInt(beforeVault.value.amount) + BigInt(amount));
  });

  it("Should fail when depositing more than balance", async () => {
    const highAmount = (depositAmount + 1) * 10 ** 9;

    let errorCaught = false;
    try {
      await depositTokens(
        program,
        user,
        mint,
        highAmount,
        userTokenAccount,
        vaultTokenAccount,
        vaultTokenLedgerPda,
        userTokenLedgerPda
      );
    } catch (err) {
      errorCaught = true;
    }
    expect(errorCaught).to.be.true;
  });
  
  it("Should fail when unauthorized user tries to deposit", async () => {
    const unauthorizedUser = await createFundedUser(provider);
    const unauthorizedUserTokenAccount = await createUserTokenAccount(
      provider.connection,
      unauthorizedUser,
      mint
    );
    
    const amount = depositAmount * 10 ** 9;
    await mintTo(
      provider.connection,
      mintAuthority,
      mint,
      unauthorizedUserTokenAccount,
      mintAuthority,
      amount
    );
    
    let errorCaught = false;
    try {
      await depositTokens(
        program,
        unauthorizedUser,
        mint,
        amount,
        unauthorizedUserTokenAccount,
        vaultTokenAccount,
        vaultTokenLedgerPda,
        userTokenLedgerPda
      );
    } catch (err) {
      errorCaught = true;
    }
    expect(errorCaught).to.be.true;
  });
});
