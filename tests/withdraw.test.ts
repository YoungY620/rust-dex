import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RustDex } from "../target/types/rust_dex";
import { 
  createMint,
  mintTo,
  createAssociatedTokenAccount,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram, SendTransactionError } from "@solana/web3.js";
import { expect } from "chai";
import { AnchorProvider } from "@coral-xyz/anchor";

describe("rust-dex: withdraw", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  
  const program = anchor.workspace.rustDex as Program<RustDex>;
  const provider = anchor.getProvider();

  let mintAuthority: Keypair;
  let mint: PublicKey;
  let userTokenAccount: PublicKey;
  let anotherUserTokenAccount: PublicKey;
  let vaultTokenAccount: PublicKey;
  let user: Keypair;
  let anotherUser: Keypair;
  let vault: Keypair;
  const depositAmount = 200; // 先存入更多，以便测试提取
  const withdrawAmount = 100; // 提取金额

  before(async () => {
    // 初始化测试所需的账户
    mintAuthority = Keypair.generate();
    user = Keypair.generate();
    vault = Keypair.generate();
    anotherUser = Keypair.generate(); // 新增另一个用户

    // 为用户账户充值
    const signature = await provider.connection.requestAirdrop(
      user.publicKey,
      200 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);
    const signature2 = await provider.connection.requestAirdrop(
        anotherUser.publicKey,
        200 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature2);

    // 为 mint authority 充值
    const mintAuthorityAirdrop = await provider.connection.requestAirdrop(
      mintAuthority.publicKey,
      20 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(mintAuthorityAirdrop);

    // 为 vault 账户充值
    const vaultAirdrop = await provider.connection.requestAirdrop(
      vault.publicKey,
      20 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(vaultAirdrop);

    // 创建 mint 账户
    mint = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      9 // 小数位数
    );

    // 创建用户的 token account 
    userTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      user,
      mint,
      user.publicKey
    );
    anotherUserTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        anotherUser,
        mint,
        anotherUser.publicKey
    );

    // 计算 PDA 地址
    const [vaultTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), mint.toBuffer()],
      program.programId
    );

    const [vaultTokenAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_account"), mint.toBuffer()],
      program.programId
    );

    // 生成新的 vault token account keypair
    const vaultTokenAccountKeypair = Keypair.generate();

    // 调用 register_vault_token_ledger 函数
    const tx = await program.methods
      .registerVaultTokenLedger()
      .accountsPartial({
        vaultTokenLedger: vaultTokenLedgerPda,
        vaultTokenAuthority: vaultTokenAuthorityPda,
        mintAccount: mint,
        vaultTokenAccount: vaultTokenAccountKeypair.publicKey,
        user: vault.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([vault, vaultTokenAccountKeypair])
      .rpc();

    // 更新 vaultTokenAccount 变量
    vaultTokenAccount = vaultTokenAccountKeypair.publicKey;

    console.log("Register vault token ledger transaction signature:", tx);

    const [individualLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_ledger"), user.publicKey.toBuffer()],
      program.programId
    );
    const [userOrderbookPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_orderbook"), user.publicKey.toBuffer()],
      program.programId
    );
    const [orderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user.publicKey.toBuffer()],
      program.programId
    );

    // 调用 register_user 函数
    const tx2 = await program.methods
      .registerUser()
      .accountsPartial({
        individualLedger: individualLedgerPda,
        userOrderBook: userOrderbookPda,
        orderEvents: orderEventsPda,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
    console.log("Register user ledger transaction signature:", tx2);

    const [anotherIndividualLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_ledger"), anotherUser.publicKey.toBuffer()],
      program.programId
    );
    const [anotherUserOrderbookPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_orderbook"), anotherUser.publicKey.toBuffer()],
      program.programId
    );
    const [anotherOrderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), anotherUser.publicKey.toBuffer()],
      program.programId
    );
    const another_tx2 = await program.methods
        .registerUser()
        .accountsPartial({
          individualLedger: anotherIndividualLedgerPda,
          userOrderBook: anotherUserOrderbookPda,
          orderEvents: anotherOrderEventsPda,
          user: anotherUser.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([anotherUser])
        .rpc();
    console.log("Register another user ledger transaction signature:", another_tx2);

    // 计算 PDA 地址
    const [userTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), mint.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );

    const tx3 = await program.methods
      .registerUserTokenLedger(mint)
      .accountsPartial({
        userTokenLedger: userTokenLedgerPda,
        mintAccount: mint,
        userTokenAccount: userTokenAccount,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log("Register user token ledger transaction signature:", tx3);

    const anotherUserTokenLedgerPda = PublicKey.findProgramAddressSync(
        [Buffer.from("individual_token_ledger"), mint.toBuffer(), anotherUser.publicKey.toBuffer()],
        program.programId
    )[0];
    const another_tx3 = await program.methods
        .registerUserTokenLedger(mint)
        .accountsPartial({
          userTokenLedger: anotherUserTokenLedgerPda,
          mintAccount: mint,
          userTokenAccount: anotherUserTokenAccount,
          user: anotherUser.publicKey,
          systemProgram: SystemProgram.programId,   
        })
        .signers([anotherUser])
        .rpc();
    console.log("Register another user token ledger transaction signature:", another_tx3);

    // 先进行 deposit 操作，为 withdraw 测试准备资金
    const amount = depositAmount * 10 ** 9;
    await mintTo(
      provider.connection,
      mintAuthority,
      mint,
      userTokenAccount,
      mintAuthority,
      amount
    );
    await mintTo(
        provider.connection,
        mintAuthority,
        mint,
        anotherUserTokenAccount,
        mintAuthority,
        amount
    );

    // 进行 deposit
    await program.methods.deposit(mint, new anchor.BN(amount))
      .accountsPartial({
        vaultTokenLedger: vaultTokenLedgerPda,
        userTokenLedger: userTokenLedgerPda,
        userTokenAccount,
        vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: user.publicKey,
        systemProgram: SystemProgram.programId
      })
      .signers([user])
      .rpc();

    console.log("Initial deposit completed for withdraw test");

    await program.methods.deposit(mint, new anchor.BN(amount))
      .accountsPartial({
        vaultTokenLedger: vaultTokenLedgerPda,
        userTokenLedger: anotherUserTokenLedgerPda,
        userTokenAccount: anotherUserTokenAccount,
        vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: anotherUser.publicKey,
        systemProgram: SystemProgram.programId
      })
      .signers([anotherUser])
      .rpc();
  });

  it("Should withdraw tokens correctly", async () => {
    // Derive PDAs for withdraw
    const [vaultTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), mint.toBuffer()],
      program.programId
    );
    const [userTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), mint.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );
    const [vaultTokenAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_account"), mint.toBuffer()],
      program.programId
    );

    const amount = withdrawAmount * 10 ** 9;

    // 获取提取前余额
    const beforeUser = await provider.connection.getTokenAccountBalance(userTokenAccount);
    const beforeAnotherUser = await provider.connection.getTokenAccountBalance(anotherUserTokenAccount);
    const beforeVault = await provider.connection.getTokenAccountBalance(vaultTokenAccount);

    console.log("Before withdraw - User balance:", beforeUser.value.amount);
    console.log("Before withdraw - Another User balance:", beforeAnotherUser.value.amount);
    console.log("Before withdraw - Vault balance:", beforeVault.value.amount);

    // 调用 withdraw
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

    // 获取提取后余额
    const afterUser = await provider.connection.getTokenAccountBalance(userTokenAccount);
    const afterVault = await provider.connection.getTokenAccountBalance(vaultTokenAccount);

    console.log("After withdraw - User balance:", afterUser.value.amount);
    console.log("After withdraw - Vault balance:", afterVault.value.amount);

    // 验证 balances - 用户余额应该增加，vault余额应该减少
    expect(BigInt(afterUser.value.amount)).to.equal(BigInt(beforeUser.value.amount) + BigInt(amount));
    expect(BigInt(afterVault.value.amount)).to.equal(BigInt(beforeVault.value.amount) - BigInt(amount));
  });

  it("Should fail when withdrawing more than vault balance", async () => {
    const [vaultTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), mint.toBuffer()],
      program.programId
    );
    const [userTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), mint.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );
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
    const [vaultTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), mint.toBuffer()],
      program.programId
    );
    const [userTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), mint.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );
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

    const [vaultTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), mint.toBuffer()],
      program.programId
    );
    const [userTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), mint.toBuffer(), user.publicKey.toBuffer()],
      program.programId
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
