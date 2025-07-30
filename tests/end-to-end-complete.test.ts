import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RustDex } from "../target/types/rust_dex";
import { 
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

describe("rust-dex: 完整端到端测试", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.rustDex as Program<RustDex>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  // 账户
  let mintAuthority: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  let vault: Keypair;

  // 代币
  let token1Mint: PublicKey; // 基础代币 (9 decimals)
  let token2Mint: PublicKey; // 报价代币 (6 decimals)

  // 用户代币账户
  let user1Token1Account: PublicKey;
  let user1Token2Account: PublicKey;
  let user2Token1Account: PublicKey;
  let user2Token2Account: PublicKey;

  // 金库代币账户
  let vaultToken1Account: PublicKey;
  let vaultToken2Account: PublicKey;

  // PDAs
  let dexManagerPda: PublicKey;
  let token1Token2QueuePda: PublicKey; // token1/token2 交易对
  let token2Token1QueuePda: PublicKey; // token2/token1 交易对

  it("完整交易流程测试", async () => {
    console.log("🚀 开始完整的DEX交易流程测试");

    // ========== 1. 初始化账户 ==========
    console.log("📋 1. 初始化账户...");
    
    // 创建资助用户
    mintAuthority = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();
    vault = Keypair.generate();

    // 为账户充值SOL
    for (const user of [mintAuthority, user1, user2, vault]) {
      const signature = await provider.connection.requestAirdrop(
        user.publicKey,
        20 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature);
    }

    // ========== 2. 创建代币 ==========
    console.log("🪙 2. 创建代币...");
    
    // 创建token1 (基础代币，9位小数)
    token1Mint = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      9
    );
    
    // 创建token2 (报价代币，6位小数)
    token2Mint = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6
    );

    console.log(`Token1 mint: ${token1Mint.toString()}`);
    console.log(`Token2 mint: ${token2Mint.toString()}`);

    // ========== 3. 创建用户代币账户 ==========
    console.log("👤 3. 创建用户代币账户...");
    
    user1Token1Account = await createAssociatedTokenAccount(
      provider.connection,
      user1,
      token1Mint,
      user1.publicKey
    );
    
    user1Token2Account = await createAssociatedTokenAccount(
      provider.connection,
      user1,
      token2Mint,
      user1.publicKey
    );
    
    user2Token1Account = await createAssociatedTokenAccount(
      provider.connection,
      user2,
      token1Mint,
      user2.publicKey
    );
    
    user2Token2Account = await createAssociatedTokenAccount(
      provider.connection,
      user2,
      token2Mint,
      user2.publicKey
    );

    // ========== 4. 为用户铸造充足的代币 ==========
    console.log("💰 4. 为用户铸造代币...");
    
    const token1Amount = 10000 * 10 ** 9; // 10000 token1
    const token2Amount = 100000 * 10 ** 6; // 100000 token2
    
    // 为用户1铸造代币
    await mintTo(
      provider.connection,
      mintAuthority,
      token1Mint,
      user1Token1Account,
      mintAuthority,
      token1Amount
    );
    
    await mintTo(
      provider.connection,
      mintAuthority,
      token2Mint,
      user1Token2Account,
      mintAuthority,
      token2Amount
    );
    
    // 为用户2铸造代币
    await mintTo(
      provider.connection,
      mintAuthority,
      token1Mint,
      user2Token1Account,
      mintAuthority,
      token1Amount
    );
    
    await mintTo(
      provider.connection,
      mintAuthority,
      token2Mint,
      user2Token2Account,
      mintAuthority,
      token2Amount
    );

    // ========== 5. 初始化DEX ==========
    console.log("🏢 5. 初始化DEX...");
    
    [dexManagerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("dex_manager")],
      program.programId
    );

    // 尝试关闭已存在的dex manager
    try {
      await program.methods.closeDexManager()
        .accountsPartial({
          dexManager: dexManagerPda,
          user: user1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();
    } catch (error) {
      console.log("没有已存在的dex_manager需要关闭");
    }

    // 初始化DEX管理器
    await program.methods.initialize()
      .accountsPartial({
        dexManager: dexManagerPda,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    console.log("✅ DEX管理器初始化完成");

    // ========== 6. 注册代币金库 ==========
    console.log("🏦 6. 注册代币金库...");
    
    // 注册token1金库
    const [vaultToken1LedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), token1Mint.toBuffer()],
      program.programId
    );

    const [vaultToken1AuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_account"), token1Mint.toBuffer()],
      program.programId
    );

    const vaultToken1AccountKeypair = Keypair.generate();
    vaultToken1Account = vaultToken1AccountKeypair.publicKey;

    await program.methods
      .registerVaultTokenLedger()
      .accountsPartial({
        vaultTokenLedger: vaultToken1LedgerPda,
        vaultTokenAuthority: vaultToken1AuthorityPda,
        mintAccount: token1Mint,
        vaultTokenAccount: vaultToken1Account,
        user: vault.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([vault, vaultToken1AccountKeypair])
      .rpc();

    // 注册token2金库
    const [vaultToken2LedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), token2Mint.toBuffer()],
      program.programId
    );

    const [vaultToken2AuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_account"), token2Mint.toBuffer()],
      program.programId
    );

    const vaultToken2AccountKeypair = Keypair.generate();
    vaultToken2Account = vaultToken2AccountKeypair.publicKey;

    await program.methods
      .registerVaultTokenLedger()
      .accountsPartial({
        vaultTokenLedger: vaultToken2LedgerPda,
        vaultTokenAuthority: vaultToken2AuthorityPda,
        mintAccount: token2Mint,
        vaultTokenAccount: vaultToken2Account,
        user: vault.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([vault, vaultToken2AccountKeypair])
      .rpc();

    console.log("✅ 代币金库注册完成");

    // ========== 7. 注册代币交易对 ==========
    console.log("💱 7. 注册代币交易对...");
    
    [token1Token2QueuePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_pair"), token1Mint.toBuffer(), token2Mint.toBuffer()],
      program.programId
    );

    [token2Token1QueuePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_pair"), token2Mint.toBuffer(), token1Mint.toBuffer()],
      program.programId
    );

    await program.methods
      .registerTokenPair(token1Mint, token2Mint)
      .accountsPartial({
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
        tokenPair: token1Token2QueuePda,
        oppositePair: token2Token1QueuePda,
      })
      .signers([user1])
      .rpc();

    console.log("✅ 交易对注册完成");

    // ========== 8. 注册用户 ==========
    console.log("👥 8. 注册用户...");
    
    // 注册用户1
    const [user1LedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_ledger"), user1.publicKey.toBuffer()],
      program.programId
    );
    
    const [user1OrderbookPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_orderbook"), user1.publicKey.toBuffer()],
      program.programId
    );
    
    const [user1EventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user1.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerUser()
      .accountsPartial({
        individualLedger: user1LedgerPda,
        userOrderBook: user1OrderbookPda,
        orderEvents: user1EventsPda,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    // 注册用户2
    const [user2LedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_ledger"), user2.publicKey.toBuffer()],
      program.programId
    );
    
    const [user2OrderbookPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_orderbook"), user2.publicKey.toBuffer()],
      program.programId
    );
    
    const [user2EventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user2.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerUser()
      .accountsPartial({
        individualLedger: user2LedgerPda,
        userOrderBook: user2OrderbookPda,
        orderEvents: user2EventsPda,
        user: user2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    console.log("✅ 用户注册完成");

    // ========== 9. 注册用户代币账本 ==========
    console.log("📚 9. 注册用户代币账本...");
    
    // 用户1的代币账本
    const [user1Token1LedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), token1Mint.toBuffer(), user1.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerUserTokenLedger(token1Mint)
      .accountsPartial({
        userTokenLedger: user1Token1LedgerPda,
        mintAccount: token1Mint,
        userTokenAccount: user1Token1Account,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    const [user1Token2LedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), token2Mint.toBuffer(), user1.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerUserTokenLedger(token2Mint)
      .accountsPartial({
        userTokenLedger: user1Token2LedgerPda,
        mintAccount: token2Mint,
        userTokenAccount: user1Token2Account,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    // 用户2的代币账本
    const [user2Token1LedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), token1Mint.toBuffer(), user2.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerUserTokenLedger(token1Mint)
      .accountsPartial({
        userTokenLedger: user2Token1LedgerPda,
        mintAccount: token1Mint,
        userTokenAccount: user2Token1Account,
        user: user2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    const [user2Token2LedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), token2Mint.toBuffer(), user2.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerUserTokenLedger(token2Mint)
      .accountsPartial({
        userTokenLedger: user2Token2LedgerPda,
        mintAccount: token2Mint,
        userTokenAccount: user2Token2Account,
        user: user2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    console.log("✅ 用户代币账本注册完成");

    // ========== 10. 用户向DEX存入代币 ==========
    console.log("💳 10. 用户向DEX存入代币...");
    
    const depositToken1Amount = 1000 * 10 ** 9; // 1000 token1
    const depositToken2Amount = 10000 * 10 ** 6; // 10000 token2
    
    // 用户1存入代币
    await program.methods.deposit(token1Mint, new anchor.BN(depositToken1Amount))
      .accountsPartial({
        vaultTokenLedger: vaultToken1LedgerPda,
        userTokenLedger: user1Token1LedgerPda,
        userTokenAccount: user1Token1Account,
        vaultTokenAccount: vaultToken1Account,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId
      })
      .signers([user1])
      .rpc();

    await program.methods.deposit(token2Mint, new anchor.BN(depositToken2Amount))
      .accountsPartial({
        vaultTokenLedger: vaultToken2LedgerPda,
        userTokenLedger: user1Token2LedgerPda,
        userTokenAccount: user1Token2Account,
        vaultTokenAccount: vaultToken2Account,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId
      })
      .signers([user1])
      .rpc();

    // 用户2存入代币
    await program.methods.deposit(token1Mint, new anchor.BN(depositToken1Amount))
      .accountsPartial({
        vaultTokenLedger: vaultToken1LedgerPda,
        userTokenLedger: user2Token1LedgerPda,
        userTokenAccount: user2Token1Account,
        vaultTokenAccount: vaultToken1Account,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: user2.publicKey,
        systemProgram: SystemProgram.programId
      })
      .signers([user2])
      .rpc();

    await program.methods.deposit(token2Mint, new anchor.BN(depositToken2Amount))
      .accountsPartial({
        vaultTokenLedger: vaultToken2LedgerPda,
        userTokenLedger: user2Token2LedgerPda,
        userTokenAccount: user2Token2Account,
        vaultTokenAccount: vaultToken2Account,
        tokenProgram: TOKEN_PROGRAM_ID,
        user: user2.publicKey,
        systemProgram: SystemProgram.programId
      })
      .signers([user2])
      .rpc();

    console.log("✅ 代币存入完成");

    // ========== 11. 显示存入后的余额 ==========
    console.log("📊 11. 显示存入后的余额...");
    
    const user1Token1LedgerBefore = await program.account.individualTokenLedgerAccount.fetch(user1Token1LedgerPda);
    const user1Token2LedgerBefore = await program.account.individualTokenLedgerAccount.fetch(user1Token2LedgerPda);
    const user2Token1LedgerBefore = await program.account.individualTokenLedgerAccount.fetch(user2Token1LedgerPda);
    const user2Token2LedgerBefore = await program.account.individualTokenLedgerAccount.fetch(user2Token2LedgerPda);

    console.log("💰 存入后余额:");
    console.log(`用户1 Token1 - 可用: ${user1Token1LedgerBefore.availableBalance.toString()}, 锁定: ${user1Token1LedgerBefore.lockedBalance.toString()}`);
    console.log(`用户1 Token2 - 可用: ${user1Token2LedgerBefore.availableBalance.toString()}, 锁定: ${user1Token2LedgerBefore.lockedBalance.toString()}`);
    console.log(`用户2 Token1 - 可用: ${user2Token1LedgerBefore.availableBalance.toString()}, 锁定: ${user2Token1LedgerBefore.lockedBalance.toString()}`);
    console.log(`用户2 Token2 - 可用: ${user2Token2LedgerBefore.availableBalance.toString()}, 锁定: ${user2Token2LedgerBefore.lockedBalance.toString()}`);

    // ========== 12. 用户1发起限价交易 ==========
    console.log("📈 12. 用户1发起限价交易 (卖出10个token1，价格为1个token2)...");
    
    const sellAmount = 10 * 10 ** 9; // 10 token1
    const sellPrice = 1; // 1 token2 per token1

    await program.methods
      .placeLimitOrder(token1Mint, token2Mint, "sell", sellPrice, new anchor.BN(sellAmount))
      .accountsPartial({
        baseQuoteQueue: token1Token2QueuePda,
        quoteBaseQueue: token2Token1QueuePda,
        dexManager: dexManagerPda,
        orderEvents: user1EventsPda,
        userBaseTokenLedger: user1Token1LedgerPda,
        userQuoteTokenLedger: user1Token2LedgerPda,
        userOrderbook: user1OrderbookPda,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    console.log("✅ 用户1限价订单已提交");

    // ========== 13. 用户2发起市价交易 ==========
    console.log("💹 13. 用户2发起市价交易 (购买10个token1)...");
    
    const buyAmount = 10 * 10 ** 9; // 10 token1

    await program.methods
      .placeMarketOrder(token1Mint, token2Mint, "buy", new anchor.BN(buyAmount))
      .accountsPartial({
        baseQuoteQueue: token1Token2QueuePda,
        quoteBaseQueue: token2Token1QueuePda,
        dexManager: dexManagerPda,
        orderEvents: user2EventsPda,
        userBaseTokenLedger: user2Token1LedgerPda,
        userQuoteTokenLedger: user2Token2LedgerPda,
        userOrderbook: user2OrderbookPda,
        user: user2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    console.log("✅ 用户2市价订单已提交，交易完成");

    // ========== 14. 处理事件队列 ==========
    console.log("🔄 14. 处理事件队列...");
    
    // 处理用户1的事件 (用户1是卖方，用户2是买方)
    await program.methods
      .consumeEvents(user2.publicKey) // 对手方是用户2
      .accountsPartial({
        eventList: user1EventsPda,
        userTokenIncomeLedger: user1Token2LedgerPda,    // 用户1收入token2
        userTokenOutcomeLedger: user1Token1LedgerPda,   // 用户1支出token1
        oppositeUserTokenIncomeLedger: user2Token1LedgerPda, // 用户2收入token1
        oppositeUserTokenOutcomeLedger: user2Token2LedgerPda, // 用户2支出token2
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    // 处理用户2的事件 (用户2是买方，用户1是卖方)
    await program.methods
      .consumeEvents(user1.publicKey) // 对手方是用户1
      .accountsPartial({
        eventList: user2EventsPda,
        userTokenIncomeLedger: user2Token1LedgerPda,    // 用户2收入token1
        userTokenOutcomeLedger: user2Token2LedgerPda,   // 用户2支出token2
        oppositeUserTokenIncomeLedger: user1Token2LedgerPda, // 用户1收入token2
        oppositeUserTokenOutcomeLedger: user1Token1LedgerPda, // 用户1支出token1
        user: user2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    console.log("✅ 所有事件已处理完成");

    // ========== 15. 显示最终余额变化 ==========
    console.log("📊 15. 显示最终余额变化...");
    
    const user1Token1LedgerAfter = await program.account.individualTokenLedgerAccount.fetch(user1Token1LedgerPda);
    const user1Token2LedgerAfter = await program.account.individualTokenLedgerAccount.fetch(user1Token2LedgerPda);
    const user2Token1LedgerAfter = await program.account.individualTokenLedgerAccount.fetch(user2Token1LedgerPda);
    const user2Token2LedgerAfter = await program.account.individualTokenLedgerAccount.fetch(user2Token2LedgerPda);

    console.log("\n🎯 最终余额:");
    console.log(`用户1 Token1 - 可用: ${user1Token1LedgerAfter.availableBalance.toString()}, 锁定: ${user1Token1LedgerAfter.lockedBalance.toString()}`);
    console.log(`用户1 Token2 - 可用: ${user1Token2LedgerAfter.availableBalance.toString()}, 锁定: ${user1Token2LedgerAfter.lockedBalance.toString()}`);
    console.log(`用户2 Token1 - 可用: ${user2Token1LedgerAfter.availableBalance.toString()}, 锁定: ${user2Token1LedgerAfter.lockedBalance.toString()}`);
    console.log(`用户2 Token2 - 可用: ${user2Token2LedgerAfter.availableBalance.toString()}, 锁定: ${user2Token2LedgerAfter.lockedBalance.toString()}`);

    console.log("\n📈 余额变化:");
    console.log(`用户1 Token1变化: ${(user1Token1LedgerAfter.availableBalance.toNumber() - user1Token1LedgerBefore.availableBalance.toNumber()) / 10 ** 9}`);
    console.log(`用户1 Token2变化: ${(user1Token2LedgerAfter.availableBalance.toNumber() - user1Token2LedgerBefore.availableBalance.toNumber()) / 10 ** 6}`);
    console.log(`用户2 Token1变化: ${(user2Token1LedgerAfter.availableBalance.toNumber() - user2Token1LedgerBefore.availableBalance.toNumber()) / 10 ** 9}`);
    console.log(`用户2 Token2变化: ${(user2Token2LedgerAfter.availableBalance.toNumber() - user2Token2LedgerBefore.availableBalance.toNumber()) / 10 ** 6}`);

    // ========== 16. 验证交易结果 ==========
    console.log("✅ 16. 验证交易结果...");
    
    // 验证用户1卖出了10个token1，获得了相应的token2
    const user1Token1Change = user1Token1LedgerAfter.availableBalance.toNumber() - user1Token1LedgerBefore.availableBalance.toNumber();
    const user1Token2Change = user1Token2LedgerAfter.availableBalance.toNumber() - user1Token2LedgerBefore.availableBalance.toNumber();
    
    // 验证用户2买入了10个token1，支付了相应的token2
    const user2Token1Change = user2Token1LedgerAfter.availableBalance.toNumber() - user2Token1LedgerBefore.availableBalance.toNumber();
    const user2Token2Change = user2Token2LedgerAfter.availableBalance.toNumber() - user2Token2LedgerBefore.availableBalance.toNumber();

    expect(user1Token1Change).to.equal(-10 * 10 ** 9); // 用户1减少10个token1
    expect(user2Token1Change).to.equal(10 * 10 ** 9);   // 用户2增加10个token1
    expect(user1Token2Change).to.be.greaterThan(0);     // 用户1获得token2
    expect(user2Token2Change).to.be.lessThan(0);        // 用户2支付token2

    console.log("🎉 交易流程测试完成！所有验证通过！");
  });
});
