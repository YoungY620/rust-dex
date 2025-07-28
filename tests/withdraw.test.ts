import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RustDex } from "../target/types/rust_dex";
import { createAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Keypair, SendTransactionError, SystemProgram } from "@solana/web3.js";
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

describe("rust-dex: withdraw", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.rustDex as Program<RustDex>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  let mint: PublicKey;
  let user: Keypair;
  let anotherUser: Keypair;
  let vault: Keypair;
  let mintAuthority: Keypair;
  let userTokenAccount: PublicKey;
  let anotherUserTokenAccount: PublicKey;
  let vaultTokenAccount: PublicKey;
  let vaultTokenLedgerPda: PublicKey;
  let userTokenLedgerPda: PublicKey;
  let anotherUserTokenLedgerPda: PublicKey;
  const depositAmount = 200;
  const withdrawAmount = 100;

  before(async () => {
    mintAuthority = await createFundedUser(provider);
    user = await createFundedUser(provider);
    anotherUser = await createFundedUser(provider);
    vault = await createFundedUser(provider);

    mint = await createTokenMint(provider.connection, mintAuthority);
    
    userTokenAccount = await createUserTokenAccount(provider.connection, user, mint);
    anotherUserTokenAccount = await createUserTokenAccount(provider.connection, anotherUser, mint);
    
    const vaultResult = await registerVaultTokenLedger(program, vault, mint);
    vaultTokenAccount = vaultResult.vaultTokenAccount;
    vaultTokenLedgerPda = vaultResult.vaultTokenLedgerPda;
    
    await registerUser(program, user);
    await registerUser(program, anotherUser);
    
    userTokenLedgerPda = await registerUserTokenLedger(program, user, mint, userTokenAccount);
    anotherUserTokenLedgerPda = await registerUserTokenLedger(program, anotherUser, mint, anotherUserTokenAccount);
    
    const amount = depositAmount * 10 ** 9;
    await mintTo(provider.connection, mintAuthority, mint, userTokenAccount, mintAuthority, amount);
    await mintTo(provider.connection, mintAuthority, mint, anotherUserTokenAccount, mintAuthority, amount);
    
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
    
    await depositTokens(
      program,
      anotherUser,
      mint,
      amount,
      anotherUserTokenAccount,
      vaultTokenAccount,
      vaultTokenLedgerPda,
      anotherUserTokenLedgerPda
    );
  });

  it("Should withdraw tokens correctly", async () => {
    const [vaultTokenAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_account"), mint.toBuffer()],
      program.programId
    );

    const amount = withdrawAmount * 10 ** 9;
    const beforeUser = await provider.connection.getTokenAccountBalance(userTokenAccount);
    const beforeVault = await provider.connection.getTokenAccountBalance(vaultTokenAccount);

    try {
      await program.methods.withdraw(mint, new anchor.BN(amount))
        .accountsPartial({
          vaultTokenLedger: vaultTokenLedgerPda,
          vaultTokenAuthority: vaultTokenAuthorityPda,
          userTokenLedger: userTokenLedgerPda,
          userTokenAccount,
          vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          user: user.publicKey,
          systemProgram: SystemProgram.programId
        })
        .signers([user])
        .rpc();
    } catch (err: any) {
      if (err instanceof SendTransactionError) {
        console.error("Withdraw transaction failed, logs:", err.logs);
      }
      throw err;
    }

    const afterUser = await provider.connection.getTokenAccountBalance(userTokenAccount);
    const afterVault = await provider.connection.getTokenAccountBalance(vaultTokenAccount);

    expect(BigInt(afterUser.value.amount)).to.equal(BigInt(beforeUser.value.amount) + BigInt(amount));
    expect(BigInt(afterVault.value.amount)).to.equal(BigInt(beforeVault.value.amount) - BigInt(amount));
  });

  it("Should fail when withdrawing more than vault balance", async () => {
    const [vaultTokenAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_account"), mint.toBuffer()],
      program.programId
    );

    // 尝试提取比vault余额更多的金额
    const excessiveAmount = (2 * depositAmount + 1) * 10 ** 9;

    let errorCaught = false;
    try {
      await program.methods.withdraw(mint, new anchor.BN(excessiveAmount))
        .accountsPartial({
          vaultTokenLedger: vaultTokenLedgerPda,
          vaultTokenAuthority: vaultTokenAuthorityPda,
          userTokenLedger: userTokenLedgerPda,
          userTokenAccount,
          vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          user: user.publicKey,
          systemProgram: SystemProgram.programId
        })
        .signers([user])
        .rpc();
    } catch (err) {
      errorCaught = true;
    }
    expect(errorCaught).to.be.true;
  });

  it("Should fail when withdrawing more than user's available balance", async () => {
    const [vaultTokenAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_account"), mint.toBuffer()],
      program.programId
    );

    // 尝试提取比用户余额更多但比 vault 余额少的金额
    const excessiveAmount = (depositAmount + withdrawAmount + 1) * 10 ** 9;
    

    let errorCaught = false;
    try {
      await program.methods.withdraw(mint, new anchor.BN(excessiveAmount))
        .accountsPartial({
          vaultTokenLedger: vaultTokenLedgerPda,
          vaultTokenAuthority: vaultTokenAuthorityPda,
          userTokenLedger: userTokenLedgerPda,
          userTokenAccount,
          vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          user: user.publicKey,
          systemProgram: SystemProgram.programId
        })
        .signers([user])
        .rpc();
    } catch (err) {
      errorCaught = true;
    }
    expect(errorCaught).to.be.true;
  });

  it("Should fail when unauthorized user tries to withdraw", async () => {
    // 创建一个未授权的用户
    const unauthorizedUser = Keypair.generate();
    
    // 为未授权用户充值
    const airdrop = await provider.connection.requestAirdrop(
      unauthorizedUser.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop);

    // 创建未授权用户的 token account
    const unauthorizedUserTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      unauthorizedUser,
      mint,
      unauthorizedUser.publicKey
    );

    const [vaultTokenAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_account"), mint.toBuffer()],
      program.programId
    );

    const amount = 10 * 10 ** 9; // 小金额

    let errorCaught = false;
    try {
      await program.methods.withdraw(mint, new anchor.BN(amount))
        .accountsPartial({
          vaultTokenLedger: vaultTokenLedgerPda,
          vaultTokenAuthority: vaultTokenAuthorityPda,
          userTokenLedger: userTokenLedgerPda, // 使用原用户的 ledger
          userTokenAccount: unauthorizedUserTokenAccount, // 但使用未授权用户的 token account
          vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          user: unauthorizedUser.publicKey, // 未授权用户签名
          systemProgram: SystemProgram.programId
        })
        .signers([unauthorizedUser])
        .rpc();
    } catch (err) {
      errorCaught = true;
    }
    expect(errorCaught).to.be.true;
  });
});
