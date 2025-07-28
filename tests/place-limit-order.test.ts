import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RustDex } from "../target/types/rust_dex";
import { mintTo } from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
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

describe("rust-dex: place_limit_order", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.rustDex as Program<RustDex>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  // Test accounts
  let mintAuthority: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  let vault: Keypair;

  // Token related
  let baseMint: PublicKey;
  let quoteMint: PublicKey;

  // Token accounts
  let user1BaseTokenAccount: PublicKey;
  let user1QuoteTokenAccount: PublicKey;
  let user2BaseTokenAccount: PublicKey;
  let user2QuoteTokenAccount: PublicKey;
  let vaultBaseTokenAccount: PublicKey;
  let vaultQuoteTokenAccount: PublicKey;

  // PDAs
  let dexManagerPda: PublicKey;
  let buyBaseQueuePda: PublicKey;
  let sellBaseQueuePda: PublicKey;
  let user1BaseTokenLedgerPda: PublicKey;
  let user1QuoteTokenLedgerPda: PublicKey;
  let user2BaseTokenLedgerPda: PublicKey;
  let user2QuoteTokenLedgerPda: PublicKey;

  const INITIAL_BASE_AMOUNT = 1000 * 10 ** 9;
  const INITIAL_QUOTE_AMOUNT = 10000 * 10 ** 6;
  const DEPOSIT_BASE_AMOUNT = 500 * 10 ** 9;
  const DEPOSIT_QUOTE_AMOUNT = 5000 * 10 ** 6;

  before(async () => {
    // Initialize accounts
    mintAuthority = await createFundedUser(provider);
    user1 = await createFundedUser(provider);
    user2 = await createFundedUser(provider);
    vault = await createFundedUser(provider);

    // Create tokens
    baseMint = await createTokenMint(provider.connection, mintAuthority, 9);
    quoteMint = await createTokenMint(provider.connection, mintAuthority, 6);

    // Create token accounts
    user1BaseTokenAccount = await createUserTokenAccount(provider.connection, user1, baseMint);
    user1QuoteTokenAccount = await createUserTokenAccount(provider.connection, user1, quoteMint);
    user2BaseTokenAccount = await createUserTokenAccount(provider.connection, user2, baseMint);
    user2QuoteTokenAccount = await createUserTokenAccount(provider.connection, user2, quoteMint);

    // Mint tokens
    await mintTo(provider.connection, mintAuthority, baseMint, user1BaseTokenAccount, mintAuthority, INITIAL_BASE_AMOUNT);
    await mintTo(provider.connection, mintAuthority, quoteMint, user1QuoteTokenAccount, mintAuthority, INITIAL_QUOTE_AMOUNT);
    await mintTo(provider.connection, mintAuthority, baseMint, user2BaseTokenAccount, mintAuthority, INITIAL_BASE_AMOUNT);
    await mintTo(provider.connection, mintAuthority, quoteMint, user2QuoteTokenAccount, mintAuthority, INITIAL_QUOTE_AMOUNT);

    // Calculate PDAs
    [dexManagerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("dex_manager")],
      program.programId
    );

    [buyBaseQueuePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_pair"), baseMint.toBuffer(), quoteMint.toBuffer()],
      program.programId
    );

    [sellBaseQueuePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_pair"), quoteMint.toBuffer(), baseMint.toBuffer()],
      program.programId
    );

    [user1BaseTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), baseMint.toBuffer(), user1.publicKey.toBuffer()],
      program.programId
    );

    [user1QuoteTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), quoteMint.toBuffer(), user1.publicKey.toBuffer()],
      program.programId
    );

    [user2BaseTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), baseMint.toBuffer(), user2.publicKey.toBuffer()],
      program.programId
    );

    [user2QuoteTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), quoteMint.toBuffer(), user2.publicKey.toBuffer()],
      program.programId
    );
  });

  it("Initialize DEX manager", async () => {
    await program.methods.initialize()
      .accountsPartial({
        dexManager: dexManagerPda,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    const dexManager = await program.account.dexManager.fetch(dexManagerPda);
    expect(dexManager.sequenceNumber.toString()).to.equal("0");
  });

  it("Register vault token ledgers for both tokens", async () => {
    const baseVaultResult = await registerVaultTokenLedger(program, vault, baseMint);
    vaultBaseTokenAccount = baseVaultResult.vaultTokenAccount;
    
    const quoteVaultResult = await registerVaultTokenLedger(program, vault, quoteMint);
    vaultQuoteTokenAccount = quoteVaultResult.vaultTokenAccount;
  });

  it("Register token pair", async () => {
    await program.methods
      .registerTokenPair(baseMint, quoteMint)
      .accountsPartial({
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
        tokenPair: buyBaseQueuePda,
        oppositePair: sellBaseQueuePda,
      })
      .signers([user1])
      .rpc();

    const tokenPairAccount = await program.account.tokenPairAccount.fetch(buyBaseQueuePda);
    expect(tokenPairAccount.buyToken.toString()).to.equal(baseMint.toString());
    expect(tokenPairAccount.sellToken.toString()).to.equal(quoteMint.toString());
  });

  it("Register users", async () => {
    await registerUser(program, user1);
    await registerUser(program, user2);
  });

  it("Register user token ledgers", async () => {
    await registerUserTokenLedger(program, user1, baseMint, user1BaseTokenAccount);
    await registerUserTokenLedger(program, user1, quoteMint, user1QuoteTokenAccount);
    await registerUserTokenLedger(program, user2, baseMint, user2BaseTokenAccount);
    await registerUserTokenLedger(program, user2, quoteMint, user2QuoteTokenAccount);
  });

  it("Users deposit tokens to DEX", async () => {
    const [vaultBaseTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), baseMint.toBuffer()],
      program.programId
    );

    const [vaultQuoteTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), quoteMint.toBuffer()],
      program.programId
    );

    // User1 base deposit
    await depositTokens(
      program,
      user1,
      baseMint,
      DEPOSIT_BASE_AMOUNT,
      user1BaseTokenAccount,
      vaultBaseTokenAccount,
      vaultBaseTokenLedgerPda,
      user1BaseTokenLedgerPda
    );

    // User1 quote deposit
    await depositTokens(
      program,
      user1,
      quoteMint,
      DEPOSIT_QUOTE_AMOUNT,
      user1QuoteTokenAccount,
      vaultQuoteTokenAccount,
      vaultQuoteTokenLedgerPda,
      user1QuoteTokenLedgerPda
    );

    // User2 base deposit
    await depositTokens(
      program,
      user2,
      baseMint,
      DEPOSIT_BASE_AMOUNT,
      user2BaseTokenAccount,
      vaultBaseTokenAccount,
      vaultBaseTokenLedgerPda,
      user2BaseTokenLedgerPda
    );

    // User2 quote deposit
    await depositTokens(
      program,
      user2,
      quoteMint,
      DEPOSIT_QUOTE_AMOUNT,
      user2QuoteTokenAccount,
      vaultQuoteTokenAccount,
      vaultQuoteTokenLedgerPda,
      user2QuoteTokenLedgerPda
    );
  });

  it("Place buy limit order (User1 buys base token with quote token)", async () => {
    // Price calculation: 1 base token (10^9 units) = 10 quote tokens (10^7 units)
    // So price = 10^7 / 10^9 = 0.01 quote_units per base_unit
    const orderPrice = 0.01; // 0.01 quote units per base unit
    const orderAmount = 100 * 10 ** 9; // 100 base tokens in minimum units

    // 计算order events PDA
    const [orderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user1.publicKey.toBuffer()],
      program.programId
    );

    // 获取用户交易前的余额
    const user1QuoteBalanceBefore = await program.account.individualTokenLedgerAccount.fetch(user1QuoteTokenLedgerPda);
    console.log("User1 quote balance before buy order:", user1QuoteBalanceBefore.availableBalance.toString());

    console.log("user1 public key:", user1.publicKey.toString());

    const tx = await program.methods
      .placeLimitOrder(baseMint, quoteMint, "buy", orderPrice, new anchor.BN(orderAmount))
      .accountsPartial({
        baseQuoteQueue: buyBaseQueuePda,
        quoteBaseQueue: sellBaseQueuePda,
        dexManager: dexManagerPda,
        orderEvents: orderEventsPda,
        userBaseTokenLedger: user1BaseTokenLedgerPda,
        userQuoteTokenLedger: user1QuoteTokenLedgerPda,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    console.log("Buy limit order placed, transaction signature:", tx);

    // 验证订单执行后的状态
    const user1QuoteBalanceAfter = await program.account.individualTokenLedgerAccount.fetch(user1QuoteTokenLedgerPda);
    // Expected quote locked = orderAmount * orderPrice = 100 * 10^9 * 0.01 = 10^9 = 1,000,000,000
    const expectedQuoteLocked = Math.floor(orderAmount * orderPrice);

    console.log("User1 quote balance after buy order:", {
      available: user1QuoteBalanceAfter.availableBalance.toString(),
      locked: user1QuoteBalanceAfter.lockedBalance.toString(),
      expectedLocked: expectedQuoteLocked.toString()
    });

    // 验证计价代币被锁定
    expect(user1QuoteBalanceAfter.lockedBalance.toString()).to.equal(expectedQuoteLocked.toString());
    expect(user1QuoteBalanceAfter.availableBalance.toString()).to.equal(
      (DEPOSIT_QUOTE_AMOUNT - expectedQuoteLocked).toString()
    );

    // 验证event list
    // const orderEvents = await program.account.eventList.fetch(orderEventsPda);
    // expect(orderEvents.inUse).to.equal(1);

    // console.log("Order events after buy order:", {
    //     user: orderEvents.user.map(u => u.toString()),
    //     buyQuantity: orderEvents.buyQuantity.map(q => q.toString()),
    //     sellQuantity: orderEvents.sellQuantity.map(q => q.toString()),
    //     tokenBuy: orderEvents.tokenBuy.toString(),
    //     tokenSell: orderEvents.tokenSell.toString(),
    //     orderId: orderEvents.orderId.toString(),
    //     length: orderEvents.length.toString(),
    //     inUse: orderEvents.inUse,
    //     bump: orderEvents.bump.toString(),
    // });
  });

  it("Place sell limit order (User2 sells base token for quote token)", async () => {
    const orderPrice = 0.01; // 0.01 quote units per base unit  
    const orderAmount = 50 * 10 ** 9; // 50 base tokens in minimum units

    // 计算order events PDA
    const [orderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user2.publicKey.toBuffer()],
      program.programId
    );

    // 获取用户交易前的余额
    const user2BaseBalanceBefore = await program.account.individualTokenLedgerAccount.fetch(user2BaseTokenLedgerPda);
    console.log("User2 base balance before sell order:", user2BaseBalanceBefore.availableBalance.toString());

    const tx = await program.methods
      .placeLimitOrder(baseMint, quoteMint, "sell", orderPrice, new anchor.BN(orderAmount))
      .accountsPartial({
        baseQuoteQueue: buyBaseQueuePda,
        quoteBaseQueue: sellBaseQueuePda,
        dexManager: dexManagerPda,
        orderEvents: orderEventsPda,
        userBaseTokenLedger: user2BaseTokenLedgerPda,
        userQuoteTokenLedger: user2QuoteTokenLedgerPda,
        user: user2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    console.log("Sell limit order placed, transaction signature:", tx);

    // 验证订单执行后的状态
    const user2BaseBalanceAfter = await program.account.individualTokenLedgerAccount.fetch(user2BaseTokenLedgerPda);

    console.log("User2 base balance after sell order:", {
      available: user2BaseBalanceAfter.availableBalance.toString(),
      locked: user2BaseBalanceAfter.lockedBalance.toString(),
      expectedLocked: orderAmount.toString()
    });

    // 验证基础代币被锁定
    expect(user2BaseBalanceAfter.lockedBalance.toString()).to.equal(orderAmount.toString());
    expect(user2BaseBalanceAfter.availableBalance.toString()).to.equal(
      (DEPOSIT_BASE_AMOUNT - orderAmount).toString()
    );
  });

  it("Place matching orders to test order book functionality", async () => {
    // User1再下一个更高价格的买单，应该可以与User2的卖单匹配
    const higherPrice = 0.011; // 更高的买价 (slightly higher than 0.01)
    const matchAmount = 25 * 10 ** 9; // 25 base tokens

    // 计算order events PDA
    const [orderEventsPda1] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user1.publicKey.toBuffer()],
      program.programId
    );

    const tx1 = await program.methods
      .placeLimitOrder(baseMint, quoteMint, "buy", higherPrice, new anchor.BN(matchAmount))
      .accountsPartial({
        baseQuoteQueue: buyBaseQueuePda,
        quoteBaseQueue: sellBaseQueuePda,
        dexManager: dexManagerPda,
        orderEvents: orderEventsPda1,
        userBaseTokenLedger: user1BaseTokenLedgerPda,
        userQuoteTokenLedger: user1QuoteTokenLedgerPda,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();
    console.log("Higher price buy order placed, transaction signature:", tx1);
    // user 2
    const [orderEventsPda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user2.publicKey.toBuffer()],
      program.programId
    );
    const tx2 = await program.methods
      .placeLimitOrder(baseMint, quoteMint, "sell", higherPrice, new anchor.BN(matchAmount))
      .accountsPartial({
        baseQuoteQueue: buyBaseQueuePda,
        quoteBaseQueue: sellBaseQueuePda,
        dexManager: dexManagerPda,
        orderEvents: orderEventsPda2,
        userBaseTokenLedger: user2BaseTokenLedgerPda,
        userQuoteTokenLedger: user2QuoteTokenLedgerPda,
        user: user2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user2])
      .rpc();
    console.log("Matching sell order placed, transaction signature:", tx2);

    const tx3 = await program.methods
      .placeLimitOrder(baseMint, quoteMint, "sell", higherPrice/10, new anchor.BN(matchAmount))
      .accountsPartial({
        baseQuoteQueue: buyBaseQueuePda,
        quoteBaseQueue: sellBaseQueuePda,
        dexManager: dexManagerPda,
        orderEvents: orderEventsPda2,
        userBaseTokenLedger: user2BaseTokenLedgerPda,
        userQuoteTokenLedger: user2QuoteTokenLedgerPda,
        user: user2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user2])
      .rpc();
    console.log("Matching sell order placed, transaction signature:", tx3);



    // 检查两个用户的余额变化
    const user1BaseBalance = await program.account.individualTokenLedgerAccount.fetch(user1BaseTokenLedgerPda);
    const user1QuoteBalance = await program.account.individualTokenLedgerAccount.fetch(user1QuoteTokenLedgerPda);
    const user2BaseBalance = await program.account.individualTokenLedgerAccount.fetch(user2BaseTokenLedgerPda);
    const user2QuoteBalance = await program.account.individualTokenLedgerAccount.fetch(user2QuoteTokenLedgerPda);

    console.log("Final balances:", {
      user1: {
        base: { available: user1BaseBalance.availableBalance.toString(), locked: user1BaseBalance.lockedBalance.toString() },
        quote: { available: user1QuoteBalance.availableBalance.toString(), locked: user1QuoteBalance.lockedBalance.toString() }
      },
      user2: {
        base: { available: user2BaseBalance.availableBalance.toString(), locked: user2BaseBalance.lockedBalance.toString() },
        quote: { available: user2QuoteBalance.availableBalance.toString(), locked: user2QuoteBalance.lockedBalance.toString() }
      }
    });
    // 验证event list
    const orderEvents = await program.account.eventList.fetch(orderEventsPda2);
    expect(orderEvents.inUse).to.equal(1);
    console.log("Order events after buy order:", {
      user: orderEvents.user.map(u => u.toString()),
      buyQuantity: orderEvents.buyQuantity.map(q => q.toString()),
      sellQuantity: orderEvents.sellQuantity.map(q => q.toString()),
      tokenBuy: orderEvents.tokenBuy.toString(),
      tokenSell: orderEvents.tokenSell.toString(),
      orderId: orderEvents.orderId.toString(),
      length: orderEvents.length.toString(),
      inUse: orderEvents.inUse,
      bump: orderEvents.bump.toString(),
    });
  });

  it("Test insufficient balance error", async () => {
    // 尝试下一个超出可用余额的订单
    const orderPrice = 0.01;
    const excessiveAmount = 10000 * 10 ** 9; // 远超用户余额的数量

    // 计算order events PDA
    const [orderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user1.publicKey.toBuffer()],
      program.programId
    );

    let errorCaught = false;

    try {
      await program.methods
        .placeLimitOrder(baseMint, quoteMint, "buy", orderPrice, new anchor.BN(excessiveAmount))
        .accountsPartial({
          baseQuoteQueue: buyBaseQueuePda,
          quoteBaseQueue: sellBaseQueuePda,
          dexManager: dexManagerPda,
          orderEvents: orderEventsPda,
          userBaseTokenLedger: user1BaseTokenLedgerPda,
          userQuoteTokenLedger: user1QuoteTokenLedgerPda,
          user: user1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // 如果没有抛出错误，测试失败
      expect.fail("Expected insufficient balance error");
    } catch (error) {
      console.log("Expected error caught:", error.message);
      errorCaught = true;
      // 检查是否是我们期望的错误类型
      expect(error.message).to.satisfy((msg) =>
        msg.includes("InsufficientBalance")
      );
    }

    expect(errorCaught).to.be.true;
  });

  it("Test invalid order side error", async () => {
    const orderPrice = 0.01;
    const orderAmount = 10 * 10 ** 9;

    // 计算order events PDA
    const [orderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user1.publicKey.toBuffer()],
      program.programId
    );

    let errorCaught = false;

    try {
      await program.methods
        .placeLimitOrder(baseMint, quoteMint, "invalid_side", orderPrice, new anchor.BN(orderAmount))
        .accountsPartial({
          baseQuoteQueue: buyBaseQueuePda,
          quoteBaseQueue: sellBaseQueuePda,
          dexManager: dexManagerPda,
          orderEvents: orderEventsPda,
          userBaseTokenLedger: user1BaseTokenLedgerPda,
          userQuoteTokenLedger: user1QuoteTokenLedgerPda,
          user: user1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      expect.fail("Expected invalid order side error");
    } catch (error) {
      console.log("Expected error caught:", error.message);
      errorCaught = true;
      // 检查是否是我们期望的错误类型
      expect(error.message).to.satisfy((msg) =>
        msg.includes("InvalidOrderSide")
      );
    }

    expect(errorCaught).to.be.true;
  });
});
