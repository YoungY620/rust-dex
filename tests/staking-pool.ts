import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram,
  LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
  getMinimumBalanceForRentExemptMint,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount
} from "@solana/spl-token";
import { RustDex } from "../target/types/rust_dex";

describe("Staking Pool", () => {
  // 配置provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  const program = anchor.workspace.rustDex as Program<RustDex>;

  // 生成测试token
  const mintKeypair = Keypair.generate();
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();

  let vaultTokenAccount: PublicKey;
  let user1TokenAccount: PublicKey;
  let user2TokenAccount: PublicKey;
  let poolPda: PublicKey;
  let user1BalancePda: PublicKey;
  let user2BalancePda: PublicKey;

  const mintAmount = 1000000; // 1M tokens
  const depositAmount = 100000; // 100K tokens

  it("1. 设置测试token", async () => {
    console.log("创建测试token...");
    
    // 计算租金
    const rentExemption = await getMinimumBalanceForRentExemptMint(connection);
    
    // 创建mint账户
    const createMintTx = new anchor.web3.Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports: rentExemption,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        6, // decimals
        wallet.publicKey,
        null,
        TOKEN_PROGRAM_ID
      )
    );
    
    await anchor.web3.sendAndConfirmTransaction(
      connection,
      createMintTx,
      [wallet.payer, mintKeypair]
    );

    // 为用户充值SOL
    await connection.requestAirdrop(user1.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(user2.publicKey, 2 * LAMPORTS_PER_SOL);
    
    // 等待充值确认
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 创建关联token账户
    const walletTokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      wallet.publicKey
    );

    user1TokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      user1.publicKey
    );

    user2TokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      user2.publicKey
    );

    vaultTokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      wallet.publicKey // 暂时使用wallet作为vault owner
    );

    // 创建token账户并铸造token
    const setupTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        walletTokenAccount,
        wallet.publicKey,
        mintKeypair.publicKey
      ),
      createAssociatedTokenAccountInstruction(
        user1.publicKey,
        user1TokenAccount,
        user1.publicKey,
        mintKeypair.publicKey
      ),
      createAssociatedTokenAccountInstruction(
        user2.publicKey,
        user2TokenAccount,
        user2.publicKey,
        mintKeypair.publicKey
      ),
      createMintToInstruction(
        mintKeypair.publicKey,
        walletTokenAccount,
        wallet.publicKey,
        mintAmount
      )
    );

    await anchor.web3.sendAndConfirmTransaction(
      connection,
      setupTx,
      [wallet.payer]
    );

    // 转一些token给用户
    const transferTx = new anchor.web3.Transaction().add(
      createTransferInstruction(
        walletTokenAccount,
        user1TokenAccount,
        wallet.publicKey,
        depositAmount * 2
      ),
      createTransferInstruction(
        walletTokenAccount,
        user2TokenAccount,
        wallet.publicKey,
        depositAmount * 2
      )
    );

    await anchor.web3.sendAndConfirmTransaction(
      connection,
      transferTx,
      [wallet.payer]
    );

    console.log("Token mint地址:", mintKeypair.publicKey.toString());
    console.log("User1 token账户:", user1TokenAccount.toString());
    console.log("User2 token账户:", user2TokenAccount.toString());
  });

  it("2. 初始化资金池", async () => {
    console.log("初始化资金池...");
    
    // 计算PDA地址
    [poolPda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("pool"),
        mintKeypair.publicKey.toBuffer()
      ],
      program.programId
    );

    try {
      const tx = await program.methods
        .initializePool(mintKeypair.publicKey)
        .accounts({
          pool: poolPda,
          vault: vaultTokenAccount,
          payer: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("资金池初始化成功，交易签名:", tx);
      console.log("资金池PDA:", poolPda.toString());
    } catch (error) {
      console.log("初始化资金池错误:", error);
    }
  });

  it("3. 初始化用户余额账户", async () => {
    console.log("初始化用户余额账户...");
    
    // 计算用户余额PDA
    [user1BalancePda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("user_balance"),
        user1.publicKey.toBuffer(),
        mintKeypair.publicKey.toBuffer()
      ],
      program.programId
    );

    [user2BalancePda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("user_balance"),
        user2.publicKey.toBuffer(),
        mintKeypair.publicKey.toBuffer()
      ],
      program.programId
    );

    try {
      // 初始化user1余额账户
      const tx1 = await program.methods
        .initializeUserBalance(mintKeypair.publicKey)
        .accounts({
          user: user1.publicKey,
          userBalance: user1BalancePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      console.log("User1余额账户初始化成功:", tx1);

      // 初始化user2余额账户
      const tx2 = await program.methods
        .initializeUserBalance(mintKeypair.publicKey)
        .accounts({
          user: user2.publicKey,
          userBalance: user2BalancePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      console.log("User2余额账户初始化成功:", tx2);
      console.log("User1余额PDA:", user1BalancePda.toString());
      console.log("User2余额PDA:", user2BalancePda.toString());
    } catch (error) {
      console.log("初始化用户余额账户错误:", error);
    }
  });

  it("4. 用户质押token", async () => {
    console.log("用户质押token...");
    
    try {
      // User1质押
      const tx1 = await program.methods
        .deposit(new anchor.BN(depositAmount))
        .accounts({
          user: user1.publicKey,
          userTokenAccount: user1TokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          pool: poolPda,
          userBalance: user1BalancePda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      console.log("User1质押成功，交易签名:", tx1);

      // User2质押
      const tx2 = await program.methods
        .deposit(new anchor.BN(depositAmount))
        .accounts({
          user: user2.publicKey,
          userTokenAccount: user2TokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          pool: poolPda,
          userBalance: user2BalancePda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      console.log("User2质押成功，交易签名:", tx2);

      // 检查余额
      const poolAccount = await program.account.poolAccount.fetch(poolPda);
      const user1Balance = await program.account.userBalanceAccount.fetch(user1BalancePda);
      const user2Balance = await program.account.userBalanceAccount.fetch(user2BalancePda);

      console.log("资金池总量:", poolAccount.totalDeposited.toString());
      console.log("User1余额:", user1Balance.balance.toString());
      console.log("User2余额:", user2Balance.balance.toString());
    } catch (error) {
      console.log("质押错误:", error);
    }
  });

  it("5. 用户取款", async () => {
    console.log("用户取款...");
    
    const withdrawAmount = depositAmount / 2; // 取出一半
    
    try {
      // User1取款
      const tx1 = await program.methods
        .withdraw(new anchor.BN(withdrawAmount))
        .accounts({
          user: user1.publicKey,
          userTokenAccount: user1TokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          pool: poolPda,
          userBalance: user1BalancePda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      console.log("User1取款成功，交易签名:", tx1);

      // 检查最终余额
      const poolAccount = await program.account.poolAccount.fetch(poolPda);
      const user1Balance = await program.account.userBalanceAccount.fetch(user1BalancePda);
      const user1TokenBalance = await getAccount(connection, user1TokenAccount);

      console.log("=== 最终状态 ===");
      console.log("资金池总量:", poolAccount.totalDeposited.toString());
      console.log("User1质押余额:", user1Balance.balance.toString());
      console.log("User1钱包余额:", user1TokenBalance.amount.toString());
      
    } catch (error) {
      console.log("取款错误:", error);
    }
  });
});
