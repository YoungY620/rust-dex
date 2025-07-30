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

describe("rust-dex: 限价交易与取消订单流程", () => {
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
  let user1OrderbookPda: PublicKey;
  let user2OrderbookPda: PublicKey;
  let user1Token1LedgerPda: PublicKey;
  let user1Token2LedgerPda: PublicKey;
  let user2Token1LedgerPda: PublicKey;
  let user2Token2LedgerPda: PublicKey;

  it("限价交易与取消订单完整流程", async () => {
    console.log("🚀 开始限价交易与取消订单流程测试");

    // ========== 1. 初始化账户 ==========
    console.log("📋 1. 初始化账户...");
    
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
    
    token1Mint = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      9
    );
    
    token2Mint = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6
    );

    // ========== 3. 创建用户代币账户并铸造代币 ==========
    console.log("👤 3. 创建用户代币账户并铸造代币...");
    
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

    // 铸造代币
    const token1Amount = 10000 * 10 ** 9; // 10000 token1
    const token2Amount = 100000 * 10 ** 6; // 100000 token2
    
    await mintTo(provider.connection, mintAuthority, token1Mint, user1Token1Account, mintAuthority, token1Amount);
    await mintTo(provider.connection, mintAuthority, token2Mint, user1Token2Account, mintAuthority, token2Amount);
    await mintTo(provider.connection, mintAuthority, token1Mint, user2Token1Account, mintAuthority, token1Amount);
    await mintTo(provider.connection, mintAuthority, token2Mint, user2Token2Account, mintAuthority, token2Amount);

    // ========== 4. 初始化DEX ==========
    console.log("🏢 4. 初始化DEX...");
    
    [dexManagerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("dex_manager")],
      program.programId
    );

    // 清理已存在的dex manager
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

    await program.methods.initialize()
      .accountsPartial({
        dexManager: dexManagerPda,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    // ========== 5. 注册代币金库 ==========
    console.log("🏦 5. 注册代币金库...");
    
    // Token1金库
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

    // Token2金库
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

    // ========== 6. 注册代币交易对 ==========
    console.log("💱 6. 注册代币交易对...");
    
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

    // ========== 7. 注册用户 ==========
    console.log("👥 7. 注册用户...");
    
    // 用户1
    const [user1LedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_ledger"), user1.publicKey.toBuffer()],
      program.programId
    );
    
    [user1OrderbookPda] = PublicKey.findProgramAddressSync(
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

    // 用户2
    const [user2LedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_ledger"), user2.publicKey.toBuffer()],
      program.programId
    );
    
    [user2OrderbookPda] = PublicKey.findProgramAddressSync(
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

    // ========== 8. 注册用户代币账本 ==========
    console.log("📚 8. 注册用户代币账本...");
    
    // 用户1代币账本
    [user1Token1LedgerPda] = PublicKey.findProgramAddressSync(
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

    [user1Token2LedgerPda] = PublicKey.findProgramAddressSync(
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

    // 用户2代币账本
    [user2Token1LedgerPda] = PublicKey.findProgramAddressSync(
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

    [user2Token2LedgerPda] = PublicKey.findProgramAddressSync(
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

    // ========== 9. 用户向DEX存入代币 ==========
    console.log("💳 9. 用户向DEX存入代币...");
    
    const depositToken1Amount = 1000 * 10 ** 9; // 1000 token1
    const depositToken2Amount = 50000 * 10 ** 6; // 50000 token2 (增加token2余额以支持更大的交易)
    
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

    // ========== 10. 用户1发起限价交易 ==========
    console.log("📈 10. 用户1发起限价交易 (卖出10个token1，价格为1个token2)...");
    
    const user1SellAmount = 10 * 10 ** 9; // 10 token1
    const user1SellPrice = 1; // 1 token2 per token1

    await program.methods
      .placeLimitOrder(token1Mint, token2Mint, "sell", user1SellPrice, new anchor.BN(user1SellAmount))
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

    // ========== 11. 用户2发起限价交易 ==========
    console.log("📉 11. 用户2发起限价交易 (买20个token1，价格为2个token2)...");
    
    const user2BuyAmount = 20 * 10 ** 9; // 20 token1 (大于用户1的10个)
    const user2BuyPrice = 2; // 2 token2 per token1 (高于用户1的卖价，会匹配用户1的全部订单，剩余10个token1的买单)

    await program.methods
      .placeLimitOrder(token1Mint, token2Mint, "buy", user2BuyPrice, new anchor.BN(user2BuyAmount))
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

    console.log("✅ 用户2限价订单已提交");

    // ========== 12. 查看订单簿状态 ==========
    console.log("📖 12. 查看订单簿状态...");
    
    // 查看交易对队列
    const token1Token2Queue = await program.account.tokenPairAccount.fetch(token1Token2QueuePda);
    const token2Token1Queue = await program.account.tokenPairAccount.fetch(token2Token1QueuePda);
    
    console.log("💼 交易对队列状态:");
    console.log(`Token1/Token2队列订单数: ${token1Token2Queue.orderHeap.size.toString()}`);
    console.log(`Token2/Token1队列订单数: ${token2Token1Queue.orderHeap.size.toString()}`);

    // 查看用户订单簿
    const user1Orderbook = await program.account.userOrderbook.fetch(user1OrderbookPda);
    const user2Orderbook = await program.account.userOrderbook.fetch(user2OrderbookPda);
    
    console.log("📋 用户订单簿:");
    console.log(`用户1订单数组长度: ${user1Orderbook.orders.length}`);
    console.log(`用户2订单数组长度: ${user2Orderbook.orders.length}`);

    // 显示用户2的订单详情（从队列中获取）
    console.log("🎯 队列中的订单详情:");
    if (token1Token2Queue.orderHeap.size.toNumber() > 0) {
      console.log("Token1/Token2队列中的订单:");
      for (let i = 0; i < token1Token2Queue.orderHeap.size.toNumber(); i++) {
        const order = token1Token2Queue.orderHeap.orders[i];
        console.log(`  订单${i + 1}:`);
        console.log(`    订单ID: ${order.id.toString()}`);
        console.log(`    买入代币: ${order.buyToken.toString()}`);
        console.log(`    卖出代币: ${order.sellToken.toString()}`);
        console.log(`    买入数量: ${order.buyQuantity.toString()}`);
        console.log(`    卖出数量: ${order.sellQuantity.toString()}`);
        console.log(`    所有者: ${order.owner.toString()}`);
        console.log(`    时间戳: ${order.timestamp.toString()}`);
      }
    }

    if (token2Token1Queue.orderHeap.size.toNumber() > 0) {
      console.log("Token2/Token1队列中的订单:");
      for (let i = 0; i < token2Token1Queue.orderHeap.size.toNumber(); i++) {
        const order = token2Token1Queue.orderHeap.orders[i];
        console.log(`  订单${i + 1}:`);
        console.log(`    订单ID: ${order.id.toString()}`);
        console.log(`    买入代币: ${order.buyToken.toString()}`);
        console.log(`    卖出代币: ${order.sellToken.toString()}`);
        console.log(`    买入数量: ${order.buyQuantity.toString()}`);
        console.log(`    卖出数量: ${order.sellQuantity.toString()}`);
        console.log(`    所有者: ${order.owner.toString()}`);
        console.log(`    时间戳: ${order.timestamp.toString()}`);
      }
    }

    // 验证用户2确实有一个活跃订单（剩余的买单在Token1/Token2队列中）
    // 由于订单部分匹配，用户1的卖单应该完全成交，用户2应该还有剩余买单
    expect(token2Token1Queue.orderHeap.size.toNumber()).to.equal(0); // 用户1的卖单已完全匹配
    expect(token1Token2Queue.orderHeap.size.toNumber()).to.be.greaterThan(0); // 用户2还有剩余买单
    const activeOrder = token1Token2Queue.orderHeap.orders[0];
    expect(activeOrder.owner.toString()).to.equal(user2.publicKey.toString());

    // 处理用户2的事件（如果有）
    const user2EventsBefore = await program.account.eventList.fetch(user2EventsPda);
    console.log(`用户2事件列表长度（处理前）: ${user2EventsBefore.length}`);

    if (user2EventsBefore.length.gt(new anchor.BN(0))) {
      console.log("处理用户2的事件...");
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
    }

    // ========== 13. 取消用户2的订单 ==========
    console.log("❌ 13. 取消用户2的剩余订单...");
    
    const orderIdToCancel = activeOrder.id; // 使用id而不是orderId
    
    await program.methods
      .cancelOrder(orderIdToCancel)
      .accountsPartial({
        baseQuoteQueue: token1Token2QueuePda, // 用户2的订单在token1Token2队列中
        userOrderBook: user2OrderbookPda,
        userSellTokenLedger: user2Token2LedgerPda,
        user: user2.publicKey,
      })
      .signers([user2])
      .rpc();

    console.log(`✅ 订单 ${orderIdToCancel.toString()} 已取消`);

    // ========== 14. 验证订单取消结果 ==========
    console.log("✅ 14. 验证订单取消结果...");
    
    // 重新获取订单簿状态
    const user2OrderbookAfterCancel = await program.account.userOrderbook.fetch(user2OrderbookPda);
    const token1Token2QueueAfterCancel = await program.account.tokenPairAccount.fetch(token1Token2QueuePda);
    
    console.log("📊 取消后状态:");
    console.log(`Token1/Token2队列订单数: ${token1Token2QueueAfterCancel.orderHeap.size.toString()}`);
    console.log(`用户2订单数组长度: ${user2OrderbookAfterCancel.orders.length}`);
    
    // 验证队列中的订单数量减少了
    expect(token1Token2QueueAfterCancel.orderHeap.size.toNumber()).to.equal(0);

    // ========== 15. 显示最终余额 ==========
    console.log("💰 15. 显示最终余额...");
    
    const user1Token1LedgerFinal = await program.account.individualTokenLedgerAccount.fetch(user1Token1LedgerPda);
    const user1Token2LedgerFinal = await program.account.individualTokenLedgerAccount.fetch(user1Token2LedgerPda);
    const user2Token1LedgerFinal = await program.account.individualTokenLedgerAccount.fetch(user2Token1LedgerPda);
    const user2Token2LedgerFinal = await program.account.individualTokenLedgerAccount.fetch(user2Token2LedgerPda);

    console.log("\n📊 最终余额:");
    console.log(`用户1 Token1 - 可用: ${(user1Token1LedgerFinal.availableBalance.toNumber() / 10 ** 9).toFixed(2)}, 锁定: ${(user1Token1LedgerFinal.lockedBalance.toNumber() / 10 ** 9).toFixed(2)}`);
    console.log(`用户1 Token2 - 可用: ${(user1Token2LedgerFinal.availableBalance.toNumber() / 10 ** 6).toFixed(2)}, 锁定: ${(user1Token2LedgerFinal.lockedBalance.toNumber() / 10 ** 6).toFixed(2)}`);
    console.log(`用户2 Token1 - 可用: ${(user2Token1LedgerFinal.availableBalance.toNumber() / 10 ** 9).toFixed(2)}, 锁定: ${(user2Token1LedgerFinal.lockedBalance.toNumber() / 10 ** 9).toFixed(2)}`);
    console.log(`用户2 Token2 - 可用: ${(user2Token2LedgerFinal.availableBalance.toNumber() / 10 ** 6).toFixed(2)}, 锁定: ${(user2Token2LedgerFinal.lockedBalance.toNumber() / 10 ** 6).toFixed(2)}`);

    console.log("🎉 限价交易与取消订单流程测试完成！");
  });
});
