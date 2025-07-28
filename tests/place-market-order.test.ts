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

describe("rust-dex: place_market_order", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.rustDex as Program<RustDex>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  // Test accounts
  let mintAuthority: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  let user3: Keypair;
  let vault: Keypair;

  // Token related
  let baseMint: PublicKey;
  let quoteMint: PublicKey;

  // Token accounts
  let user1BaseTokenAccount: PublicKey;
  let user1QuoteTokenAccount: PublicKey;
  let user2BaseTokenAccount: PublicKey;
  let user2QuoteTokenAccount: PublicKey;
  let user3BaseTokenAccount: PublicKey;
  let user3QuoteTokenAccount: PublicKey;
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
  let user3BaseTokenLedgerPda: PublicKey;
  let user3QuoteTokenLedgerPda: PublicKey;

  const INITIAL_BASE_AMOUNT = 1000 * 10 ** 9;
  const INITIAL_QUOTE_AMOUNT = 10000 * 10 ** 6;
  const DEPOSIT_BASE_AMOUNT = 500 * 10 ** 9;
  const DEPOSIT_QUOTE_AMOUNT = 5000 * 10 ** 6;

  // 工具函数：计算总余额
  const calculateTotalBalances = (balances: any[]) => {
    return balances.reduce((total, balance) => ({
      base: total.base.add(balance.availableBalance || 0).add(balance.lockedBalance || 0),
      quote: total.quote.add(balance.availableBalance || 0).add(balance.lockedBalance || 0)
    }), { base: new anchor.BN(0), quote: new anchor.BN(0) });
  };

  // 工具函数：验证余额守恒
  const verifyBalanceConservation = (beforeBalances: any, afterBalances: any, tokenType: string) => {
    expect(afterBalances.toString()).to.equal(beforeBalances.toString(), `${tokenType} token总余额应保持不变`);
  };

  // 工具函数：解析事件记录
  const parseOrderEvents = (orderEvents: any, targetUser: PublicKey) => {
    let totalBuyQuantity = new anchor.BN(0);
    let totalSellQuantity = new anchor.BN(0);
    const events = [];

    const length = orderEvents.length.toNumber ? orderEvents.length.toNumber() : Number(orderEvents.length);
    
    for (let i = 0; i < length; i++) {
      const event = {
        user: orderEvents.user[i].toString(),
        buyQuantity: new anchor.BN(orderEvents.buyQuantity[i]),
        sellQuantity: new anchor.BN(orderEvents.sellQuantity[i])
      };
      events.push(event);

      if (event.user === targetUser.toString()) {
        totalBuyQuantity = totalBuyQuantity.add(event.buyQuantity);
        totalSellQuantity = totalSellQuantity.add(event.sellQuantity);
      }
    }

    return { totalBuyQuantity, totalSellQuantity, events, length };
  };

  // 工具函数：验证市价买单成交
  const verifyMarketBuyExecution = (
    userBaseBalanceBefore: any,
    userBaseBalanceAfter: any,
    userQuoteBalanceBefore: any,
    userQuoteBalanceAfter: any,
    totalBuyQuantity: anchor.BN,
    totalSellQuantity: anchor.BN
  ) => {
    const actualBaseIncrease = userBaseBalanceAfter.availableBalance.sub(userBaseBalanceBefore.availableBalance);
    const actualQuoteDecrease = userQuoteBalanceBefore.availableBalance.sub(userQuoteBalanceAfter.availableBalance);

    console.log("市价买单成交验证:", {
      totalBuyQuantity: totalBuyQuantity.toString(),
      totalSellQuantity: totalSellQuantity.toString(),
      actualBaseIncrease: actualBaseIncrease.toString(),
      actualQuoteDecrease: actualQuoteDecrease.toString()
    });

    expect(actualBaseIncrease.toString()).to.equal(totalBuyQuantity.toString(), "用户收入的base token应该等于buyQuantity总和");
    expect(actualQuoteDecrease.toString()).to.equal(totalSellQuantity.toString(), "用户支出的quote token应该等于sellQuantity总和");
  };

  // 工具函数：验证市价卖单成交
  const verifyMarketSellExecution = (
    userBaseBalanceBefore: any,
    userBaseBalanceAfter: any,
    userQuoteBalanceBefore: any,
    userQuoteBalanceAfter: any,
    totalBuyQuantity: anchor.BN,
    totalSellQuantity: anchor.BN
  ) => {
    const actualBaseDecrease = userBaseBalanceBefore.availableBalance.sub(userBaseBalanceAfter.availableBalance);
    const actualQuoteIncrease = userQuoteBalanceAfter.availableBalance.sub(userQuoteBalanceBefore.availableBalance);

    console.log("市价卖单成交验证:", {
      totalBuyQuantity: totalBuyQuantity.toString(),
      totalSellQuantity: totalSellQuantity.toString(),
      actualQuoteIncrease: actualQuoteIncrease.toString(),
      actualBaseDecrease: actualBaseDecrease.toString()
    });

    expect(actualQuoteIncrease.toString()).to.equal(totalBuyQuantity.toString(), "用户收入的quote token应该等于buyQuantity总和");
    expect(actualBaseDecrease.toString()).to.equal(totalSellQuantity.toString(), "用户支出的base token应该等于sellQuantity总和");
  };

  // 工具函数：创建并设置新用户
  const createAndSetupNewUser = async (depositBase = true, depositQuote = true) => {
    const newUser = await createFundedUser(provider);
    const baseTokenAccount = await createUserTokenAccount(provider.connection, newUser, baseMint);
    const quoteTokenAccount = await createUserTokenAccount(provider.connection, newUser, quoteMint);

    // Mint tokens
    await mintTo(provider.connection, mintAuthority, baseMint, baseTokenAccount, mintAuthority, INITIAL_BASE_AMOUNT);
    await mintTo(provider.connection, mintAuthority, quoteMint, quoteTokenAccount, mintAuthority, INITIAL_QUOTE_AMOUNT);

    // Register user
    await registerUser(program, newUser);

    // Register token ledgers
    const baseTokenLedgerPda = await registerUserTokenLedger(program, newUser, baseMint, baseTokenAccount);
    const quoteTokenLedgerPda = await registerUserTokenLedger(program, newUser, quoteMint, quoteTokenAccount);

    // Get vault PDAs
    const [vaultBaseTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), baseMint.toBuffer()],
      program.programId
    );
    const [vaultQuoteTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), quoteMint.toBuffer()],
      program.programId
    );

    // Deposit tokens
    if (depositBase) {
      await depositTokens(program, newUser, baseMint, DEPOSIT_BASE_AMOUNT, baseTokenAccount, vaultBaseTokenAccount, vaultBaseTokenLedgerPda, baseTokenLedgerPda);
    }
    if (depositQuote) {
      await depositTokens(program, newUser, quoteMint, DEPOSIT_QUOTE_AMOUNT, quoteTokenAccount, vaultQuoteTokenAccount, vaultQuoteTokenLedgerPda, quoteTokenLedgerPda);
    }

    return {
      user: newUser,
      baseTokenAccount,
      quoteTokenAccount,
      baseTokenLedgerPda,
      quoteTokenLedgerPda
    };
  };

  before(async () => {
    // Initialize accounts
    mintAuthority = await createFundedUser(provider);
    user1 = await createFundedUser(provider);
    user2 = await createFundedUser(provider);
    user3 = await createFundedUser(provider);
    vault = await createFundedUser(provider);

    // Create tokens
    baseMint = await createTokenMint(provider.connection, mintAuthority, 9);
    quoteMint = await createTokenMint(provider.connection, mintAuthority, 6);

    // Create token accounts
    user1BaseTokenAccount = await createUserTokenAccount(provider.connection, user1, baseMint);
    user1QuoteTokenAccount = await createUserTokenAccount(provider.connection, user1, quoteMint);
    user2BaseTokenAccount = await createUserTokenAccount(provider.connection, user2, baseMint);
    user2QuoteTokenAccount = await createUserTokenAccount(provider.connection, user2, quoteMint);
    user3BaseTokenAccount = await createUserTokenAccount(provider.connection, user3, baseMint);
    user3QuoteTokenAccount = await createUserTokenAccount(provider.connection, user3, quoteMint);

    // Mint tokens
    await mintTo(provider.connection, mintAuthority, baseMint, user1BaseTokenAccount, mintAuthority, INITIAL_BASE_AMOUNT);
    await mintTo(provider.connection, mintAuthority, quoteMint, user1QuoteTokenAccount, mintAuthority, INITIAL_QUOTE_AMOUNT);
    await mintTo(provider.connection, mintAuthority, baseMint, user2BaseTokenAccount, mintAuthority, INITIAL_BASE_AMOUNT);
    await mintTo(provider.connection, mintAuthority, quoteMint, user2QuoteTokenAccount, mintAuthority, INITIAL_QUOTE_AMOUNT);
    await mintTo(provider.connection, mintAuthority, baseMint, user3BaseTokenAccount, mintAuthority, INITIAL_BASE_AMOUNT);
    await mintTo(provider.connection, mintAuthority, quoteMint, user3QuoteTokenAccount, mintAuthority, INITIAL_QUOTE_AMOUNT);

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

    [user3BaseTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), baseMint.toBuffer(), user3.publicKey.toBuffer()],
      program.programId
    );

    [user3QuoteTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), quoteMint.toBuffer(), user3.publicKey.toBuffer()],
      program.programId
    );

    // Initialize DEX manager
    await program.methods.initialize()
      .accountsPartial({
        dexManager: dexManagerPda,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    // Register vault token ledgers
    const baseVaultResult = await registerVaultTokenLedger(program, vault, baseMint);
    vaultBaseTokenAccount = baseVaultResult.vaultTokenAccount;
    
    const quoteVaultResult = await registerVaultTokenLedger(program, vault, quoteMint);
    vaultQuoteTokenAccount = quoteVaultResult.vaultTokenAccount;

    // Register token pair
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

    // Register users
    await registerUser(program, user1);
    await registerUser(program, user2);
    await registerUser(program, user3);

    // Register user token ledgers
    await registerUserTokenLedger(program, user1, baseMint, user1BaseTokenAccount);
    await registerUserTokenLedger(program, user1, quoteMint, user1QuoteTokenAccount);
    await registerUserTokenLedger(program, user2, baseMint, user2BaseTokenAccount);
    await registerUserTokenLedger(program, user2, quoteMint, user2QuoteTokenAccount);
    await registerUserTokenLedger(program, user3, baseMint, user3BaseTokenAccount);
    await registerUserTokenLedger(program, user3, quoteMint, user3QuoteTokenAccount);

    // Users deposit tokens
    const [vaultBaseTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), baseMint.toBuffer()],
      program.programId
    );

    const [vaultQuoteTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), quoteMint.toBuffer()],
      program.programId
    );

    await depositTokens(program, user1, baseMint, DEPOSIT_BASE_AMOUNT, user1BaseTokenAccount, vaultBaseTokenAccount, vaultBaseTokenLedgerPda, user1BaseTokenLedgerPda);
    await depositTokens(program, user1, quoteMint, DEPOSIT_QUOTE_AMOUNT, user1QuoteTokenAccount, vaultQuoteTokenAccount, vaultQuoteTokenLedgerPda, user1QuoteTokenLedgerPda);
    await depositTokens(program, user2, baseMint, DEPOSIT_BASE_AMOUNT, user2BaseTokenAccount, vaultBaseTokenAccount, vaultBaseTokenLedgerPda, user2BaseTokenLedgerPda);
    await depositTokens(program, user2, quoteMint, DEPOSIT_QUOTE_AMOUNT, user2QuoteTokenAccount, vaultQuoteTokenAccount, vaultQuoteTokenLedgerPda, user2QuoteTokenLedgerPda);
    await depositTokens(program, user3, baseMint, DEPOSIT_BASE_AMOUNT, user3BaseTokenAccount, vaultBaseTokenAccount, vaultBaseTokenLedgerPda, user3BaseTokenLedgerPda);
    await depositTokens(program, user3, quoteMint, DEPOSIT_QUOTE_AMOUNT, user3QuoteTokenAccount, vaultQuoteTokenAccount, vaultQuoteTokenLedgerPda, user3QuoteTokenLedgerPda);
  });

  it("Place market buy order in empty order book", async () => {
    const marketBuyAmount = 100 * 10 ** 9; // 100 base tokens

    const [orderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user1.publicKey.toBuffer()],
      program.programId
    );

    const user1QuoteBalanceBefore = await program.account.individualTokenLedgerAccount.fetch(user1QuoteTokenLedgerPda);
    console.log("User1 quote balance before market buy:", user1QuoteBalanceBefore.availableBalance.toString());

    const tx = await program.methods
      .placeMarketOrder(baseMint, quoteMint, "buy", new anchor.BN(marketBuyAmount))
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

    console.log("Market buy order placed in empty book, tx:", tx);

    // 验证市价买单在空订单簿中的行为 - 应该锁定所有可用余额
    const user1QuoteBalanceAfter = await program.account.individualTokenLedgerAccount.fetch(user1QuoteTokenLedgerPda);
    console.log("User1 quote balance after market buy:", {
      available: user1QuoteBalanceAfter.availableBalance.toString(),
      locked: user1QuoteBalanceAfter.lockedBalance.toString()
    });

    // 检查eventlist - 在空订单簿中，市价订单应该作为限价订单放入，没有立即成交
    const orderEvents = await program.account.eventList.fetch(orderEventsPda);
    console.log("Empty book market buy order events:", {
      inUse: orderEvents.inUse,
      length: orderEvents.length.toString(),
      orderId: orderEvents.orderId.toString(),
      tokenBuy: orderEvents.tokenBuy.toString(),
      tokenSell: orderEvents.tokenSell.toString(),
    });

    // 验证事件记录的正确性 - 空订单簿中应该没有成交事件
    expect(orderEvents.inUse).to.equal(1);
    expect(orderEvents.tokenBuy.toString()).to.equal(baseMint.toString());
    expect(orderEvents.tokenSell.toString()).to.equal(quoteMint.toString());
    const eventLength = orderEvents.length.toNumber ? orderEvents.length.toNumber() : Number(orderEvents.length);
    expect(eventLength).to.equal(0, "空订单簿中应该没有成交事件");

    // 市价买单应该锁定所有可用quote余额
    expect(user1QuoteBalanceAfter.lockedBalance.toString()).to.equal(user1QuoteBalanceBefore.availableBalance.toString());
    expect(user1QuoteBalanceAfter.availableBalance.toString()).to.equal("0");
  });

  it("Place market sell order in empty order book", async () => {
    const marketSellAmount = 50 * 10 ** 9; // 50 base tokens

    const [orderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user2.publicKey.toBuffer()],
      program.programId
    );

    const user2BaseBalanceBefore = await program.account.individualTokenLedgerAccount.fetch(user2BaseTokenLedgerPda);
    console.log("User2 base balance before market sell:", user2BaseBalanceBefore.availableBalance.toString());

    const tx = await program.methods
      .placeMarketOrder(baseMint, quoteMint, "sell", new anchor.BN(marketSellAmount))
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

    console.log("Market sell order placed in empty book, tx:", tx);

    // 验证市价卖单锁定指定数量的base token
    const user2BaseBalanceAfter = await program.account.individualTokenLedgerAccount.fetch(user2BaseTokenLedgerPda);
    console.log("User2 base balance after market sell:", {
      available: user2BaseBalanceAfter.availableBalance.toString(),
      locked: user2BaseBalanceAfter.lockedBalance.toString()
    });

    // 检查eventlist - 空订单簿中没有成交
    const orderEvents = await program.account.eventList.fetch(orderEventsPda);
    console.log("Empty book market sell order events:", {
      inUse: orderEvents.inUse,
      length: orderEvents.length.toString(),
      orderId: orderEvents.orderId.toString(),
      tokenBuy: orderEvents.tokenBuy.toString(),
      tokenSell: orderEvents.tokenSell.toString(),
    });

    // 验证事件记录的正确性 - 空订单簿中应该没有成交事件
    expect(orderEvents.inUse).to.equal(1);
    expect(orderEvents.tokenBuy.toString()).to.equal(quoteMint.toString());
    expect(orderEvents.tokenSell.toString()).to.equal(baseMint.toString());
    const eventLength = orderEvents.length.toNumber ? orderEvents.length.toNumber() : Number(orderEvents.length);
    expect(eventLength).to.equal(0, "空订单簿中应该没有成交事件");

    expect(user2BaseBalanceAfter.lockedBalance.toString()).to.equal(marketSellAmount.toString());
    expect(user2BaseBalanceAfter.availableBalance.toString()).to.equal(
      (DEPOSIT_BASE_AMOUNT - marketSellAmount).toString()
    );
  });

  it("Place limit orders to create liquidity for market order testing", async () => {
    // User3 places some limit orders to provide liquidity
    const limitPrice = 0.01; // 0.01 quote units per base unit
    const limitAmount = 75 * 10 ** 9; // 75 base tokens

    const [orderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user3.publicKey.toBuffer()],
      program.programId
    );

    // Place a limit sell order
    await program.methods
      .placeLimitOrder(baseMint, quoteMint, "sell", limitPrice, new anchor.BN(limitAmount))
      .accountsPartial({
        baseQuoteQueue: buyBaseQueuePda,
        quoteBaseQueue: sellBaseQueuePda,
        dexManager: dexManagerPda,
        orderEvents: orderEventsPda,
        userBaseTokenLedger: user3BaseTokenLedgerPda,
        userQuoteTokenLedger: user3QuoteTokenLedgerPda,
        user: user3.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user3])
      .rpc();

    // Place a limit buy order at a lower price
    await program.methods
      .placeLimitOrder(baseMint, quoteMint, "buy", limitPrice * 0.9, new anchor.BN(limitAmount))
      .accountsPartial({
        baseQuoteQueue: buyBaseQueuePda,
        quoteBaseQueue: sellBaseQueuePda,
        dexManager: dexManagerPda,
        orderEvents: orderEventsPda,
        userBaseTokenLedger: user3BaseTokenLedgerPda,
        userQuoteTokenLedger: user3QuoteTokenLedgerPda,
        user: user3.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user3])
      .rpc();

    console.log("Limit orders placed to create liquidity");
  });

  it("Market buy order should match with existing limit sell orders", async () => {
    // 创建新用户进行匹配测试
    const { user: marketUser, baseTokenLedgerPda: marketUserBaseTokenLedgerPda, quoteTokenLedgerPda: marketUserQuoteTokenLedgerPda } = 
      await createAndSetupNewUser();

    const marketBuyAmount = 30 * 10 ** 9; // 30 base tokens

    const [orderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), marketUser.publicKey.toBuffer()],
      program.programId
    );

    // Get balances before
    const marketUserBaseBalanceBefore = await program.account.individualTokenLedgerAccount.fetch(marketUserBaseTokenLedgerPda);
    const marketUserQuoteBalanceBefore = await program.account.individualTokenLedgerAccount.fetch(marketUserQuoteTokenLedgerPda);
    const user3BaseBalanceBefore = await program.account.individualTokenLedgerAccount.fetch(user3BaseTokenLedgerPda);
    const user3QuoteBalanceBefore = await program.account.individualTokenLedgerAccount.fetch(user3QuoteTokenLedgerPda);

    // 计算总余额（余额守恒检查）
    const totalBaseBefore = marketUserBaseBalanceBefore.availableBalance.add(marketUserBaseBalanceBefore.lockedBalance)
      .add(user3BaseBalanceBefore.availableBalance).add(user3BaseBalanceBefore.lockedBalance);
    const totalQuoteBefore = marketUserQuoteBalanceBefore.availableBalance.add(marketUserQuoteBalanceBefore.lockedBalance)
      .add(user3QuoteBalanceBefore.availableBalance).add(user3QuoteBalanceBefore.lockedBalance);

    console.log("Total balances before matching:", {
      totalBase: totalBaseBefore.toString(),
      totalQuote: totalQuoteBefore.toString()
    });

    const tx = await program.methods
      .placeMarketOrder(baseMint, quoteMint, "buy", new anchor.BN(marketBuyAmount))
      .accountsPartial({
        baseQuoteQueue: buyBaseQueuePda,
        quoteBaseQueue: sellBaseQueuePda,
        dexManager: dexManagerPda,
        orderEvents: orderEventsPda,
        userBaseTokenLedger: marketUserBaseTokenLedgerPda,
        userQuoteTokenLedger: marketUserQuoteTokenLedgerPda,
        user: marketUser.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([marketUser])
      .rpc();

    console.log("Market buy order matched with limit sell, tx:", tx);

    // Get balances after
    const marketUserBaseBalanceAfter = await program.account.individualTokenLedgerAccount.fetch(marketUserBaseTokenLedgerPda);
    const marketUserQuoteBalanceAfter = await program.account.individualTokenLedgerAccount.fetch(marketUserQuoteTokenLedgerPda);
    const user3BaseBalanceAfter = await program.account.individualTokenLedgerAccount.fetch(user3BaseTokenLedgerPda);
    const user3QuoteBalanceAfter = await program.account.individualTokenLedgerAccount.fetch(user3QuoteTokenLedgerPda);

    // 计算总余额（余额守恒检查）
    const totalBaseAfter = marketUserBaseBalanceAfter.availableBalance.add(marketUserBaseBalanceAfter.lockedBalance)
      .add(user3BaseBalanceAfter.availableBalance).add(user3BaseBalanceAfter.lockedBalance);
    const totalQuoteAfter = marketUserQuoteBalanceAfter.availableBalance.add(marketUserQuoteBalanceAfter.lockedBalance)
      .add(user3QuoteBalanceAfter.availableBalance).add(user3QuoteBalanceAfter.lockedBalance);

    console.log("Total balances after matching:", {
      totalBase: totalBaseAfter.toString(),
      totalQuote: totalQuoteAfter.toString()
    });

    // 验证余额守恒
    verifyBalanceConservation(totalBaseBefore, totalBaseAfter, "Base");
    verifyBalanceConservation(totalQuoteBefore, totalQuoteAfter, "Quote");

    // 验证事件列表
    const orderEvents = await program.account.eventList.fetch(orderEventsPda);
    console.log("Market buy matching order events:", {
      inUse: orderEvents.inUse,
      length: orderEvents.length.toString(),
      orderId: orderEvents.orderId.toString(),
      tokenBuy: orderEvents.tokenBuy.toString(),
      tokenSell: orderEvents.tokenSell.toString(),
    });

    expect(orderEvents.inUse).to.equal(1);

    // 解析和验证成交记录
    const { totalBuyQuantity, totalSellQuantity, events, length } = parseOrderEvents(orderEvents, marketUser.publicKey);
    
    if (length > 0) {
      console.log("成交记录详情:");
      events.forEach((event, i) => {
        console.log(`成交 ${i}:`, {
          user: event.user,
          buyQuantity: event.buyQuantity.toString(),
          sellQuantity: event.sellQuantity.toString()
        });
      });

      // 验证市价买单成交
      verifyMarketBuyExecution(
        marketUserBaseBalanceBefore,
        marketUserBaseBalanceAfter,
        marketUserQuoteBalanceBefore,
        marketUserQuoteBalanceAfter,
        totalBuyQuantity,
        totalSellQuantity
      );
    }
  });

  it("Market sell order should match with existing limit buy orders", async () => {
    // 创建新用户进行卖单匹配测试
    const { user: marketSellUser, baseTokenLedgerPda: marketSellUserBaseTokenLedgerPda, quoteTokenLedgerPda: marketSellUserQuoteTokenLedgerPda } = 
      await createAndSetupNewUser();

    const marketSellAmount = 20 * 10 ** 9; // 20 base tokens

    const [orderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), marketSellUser.publicKey.toBuffer()],
      program.programId
    );

    // Get balances before
    const marketSellUserBaseBalanceBefore = await program.account.individualTokenLedgerAccount.fetch(marketSellUserBaseTokenLedgerPda);
    const marketSellUserQuoteBalanceBefore = await program.account.individualTokenLedgerAccount.fetch(marketSellUserQuoteTokenLedgerPda);
    const user3BaseBalanceBeforeSell = await program.account.individualTokenLedgerAccount.fetch(user3BaseTokenLedgerPda);
    const user3QuoteBalanceBeforeSell = await program.account.individualTokenLedgerAccount.fetch(user3QuoteTokenLedgerPda);

    // 计算总余额（余额守恒检查）
    const totalBaseBeforeSell = marketSellUserBaseBalanceBefore.availableBalance.add(marketSellUserBaseBalanceBefore.lockedBalance)
      .add(user3BaseBalanceBeforeSell.availableBalance).add(user3BaseBalanceBeforeSell.lockedBalance);
    const totalQuoteBeforeSell = marketSellUserQuoteBalanceBefore.availableBalance.add(marketSellUserQuoteBalanceBefore.lockedBalance)
      .add(user3QuoteBalanceBeforeSell.availableBalance).add(user3QuoteBalanceBeforeSell.lockedBalance);

    console.log("Total balances before sell matching:", {
      totalBase: totalBaseBeforeSell.toString(),
      totalQuote: totalQuoteBeforeSell.toString()
    });

    const tx = await program.methods
      .placeMarketOrder(baseMint, quoteMint, "sell", new anchor.BN(marketSellAmount))
      .accountsPartial({
        baseQuoteQueue: buyBaseQueuePda,
        quoteBaseQueue: sellBaseQueuePda,
        dexManager: dexManagerPda,
        orderEvents: orderEventsPda,
        userBaseTokenLedger: marketSellUserBaseTokenLedgerPda,
        userQuoteTokenLedger: marketSellUserQuoteTokenLedgerPda,
        user: marketSellUser.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([marketSellUser])
      .rpc();

    console.log("Market sell order matched with limit buy, tx:", tx);

    // Get balances after
    const marketSellUserBaseBalanceAfter = await program.account.individualTokenLedgerAccount.fetch(marketSellUserBaseTokenLedgerPda);
    const marketSellUserQuoteBalanceAfter = await program.account.individualTokenLedgerAccount.fetch(marketSellUserQuoteTokenLedgerPda);
    const user3BaseBalanceAfterSell = await program.account.individualTokenLedgerAccount.fetch(user3BaseTokenLedgerPda);
    const user3QuoteBalanceAfterSell = await program.account.individualTokenLedgerAccount.fetch(user3QuoteTokenLedgerPda);

    // 计算总余额（余额守恒检查）
    const totalBaseAfterSell = marketSellUserBaseBalanceAfter.availableBalance.add(marketSellUserBaseBalanceAfter.lockedBalance)
      .add(user3BaseBalanceAfterSell.availableBalance).add(user3BaseBalanceAfterSell.lockedBalance);
    const totalQuoteAfterSell = marketSellUserQuoteBalanceAfter.availableBalance.add(marketSellUserQuoteBalanceAfter.lockedBalance)
      .add(user3QuoteBalanceAfterSell.availableBalance).add(user3QuoteBalanceAfterSell.lockedBalance);

    console.log("Total balances after sell matching:", {
      totalBase: totalBaseAfterSell.toString(),
      totalQuote: totalQuoteAfterSell.toString()
    });

    // 验证余额守恒
    verifyBalanceConservation(totalBaseBeforeSell, totalBaseAfterSell, "Base");
    verifyBalanceConservation(totalQuoteBeforeSell, totalQuoteAfterSell, "Quote");

    // 验证事件列表
    const orderEvents = await program.account.eventList.fetch(orderEventsPda);
    console.log("Market sell matching order events:", {
      inUse: orderEvents.inUse,
      length: orderEvents.length.toString(),
      orderId: orderEvents.orderId.toString(),
      tokenBuy: orderEvents.tokenBuy.toString(),
      tokenSell: orderEvents.tokenSell.toString(),
    });

    expect(orderEvents.inUse).to.equal(1);

    // 解析和验证成交记录
    const { totalBuyQuantity, totalSellQuantity, events, length } = parseOrderEvents(orderEvents, marketSellUser.publicKey);
    
    if (length > 0) {
      console.log("卖单成交记录详情:");
      events.forEach((event, i) => {
        console.log(`成交 ${i}:`, {
          user: event.user,
          buyQuantity: event.buyQuantity.toString(),
          sellQuantity: event.sellQuantity.toString()
        });
      });

      // 验证市价卖单成交
      verifyMarketSellExecution(
        marketSellUserBaseBalanceBefore,
        marketSellUserBaseBalanceAfter,
        marketSellUserQuoteBalanceBefore,
        marketSellUserQuoteBalanceAfter,
        totalBuyQuantity,
        totalSellQuantity
      );
    }
  });

  it("Should fail when market sell amount exceeds available balance", async () => {
    const excessiveAmount = 1000 * 10 ** 9; // 远超用户余额

    const [orderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user1.publicKey.toBuffer()],
      program.programId
    );

    let errorCaught = false;
    try {
      await program.methods
        .placeMarketOrder(baseMint, quoteMint, "sell", new anchor.BN(excessiveAmount))
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

      expect.fail("Expected insufficient balance error");
    } catch (error) {
      console.log("Expected error caught:", error.message);
      errorCaught = true;
      expect(error.message).to.satisfy((msg) =>
        msg.includes("InsufficientBalance")
      );
    }
    expect(errorCaught).to.be.true;
  });

  it("Should fail with invalid order side", async () => {
    const orderAmount = 10 * 10 ** 9;

    const [orderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user1.publicKey.toBuffer()],
      program.programId
    );

    let errorCaught = false;
    try {
      await program.methods
        .placeMarketOrder(baseMint, quoteMint, "invalid_side", new anchor.BN(orderAmount))
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
      expect(error.message).to.satisfy((msg) =>
        msg.includes("InvalidOrderSide")
      );
    }
    expect(errorCaught).to.be.true;
  });

  it("Market buy order with zero available quote balance should fail", async () => {
    // 创建一个新用户，但不给他存入任何quote代币
    const { user: newUser, baseTokenLedgerPda: newUserBaseTokenLedgerPda, quoteTokenLedgerPda: newUserQuoteTokenLedgerPda } = 
      await createAndSetupNewUser(true, false); // 只存入base，不存入quote

    const [orderEventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), newUser.publicKey.toBuffer()],
      program.programId
    );

    // 验证用户确实没有quote余额
    const userQuoteBalance = await program.account.individualTokenLedgerAccount.fetch(newUserQuoteTokenLedgerPda);
    console.log("New user quote balance (should be zero):", {
      available: userQuoteBalance.availableBalance.toString(),
      locked: userQuoteBalance.lockedBalance.toString()
    });

    // 现在尝试下一个市价买单，应该失败
    let errorCaught = false;
    try {
      await program.methods
        .placeMarketOrder(baseMint, quoteMint, "buy", new anchor.BN(1))
        .accountsPartial({
          baseQuoteQueue: buyBaseQueuePda,
          quoteBaseQueue: sellBaseQueuePda,
          dexManager: dexManagerPda,
          orderEvents: orderEventsPda,
          userBaseTokenLedger: newUserBaseTokenLedgerPda,
          userQuoteTokenLedger: newUserQuoteTokenLedgerPda,
          user: newUser.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([newUser])
        .rpc();

      expect.fail("Expected insufficient balance error");
    } catch (error) {
      console.log("Expected error caught:", error.message);
      errorCaught = true;
      expect(error.message).to.satisfy((msg) =>
        msg.includes("InsufficientBalance")
      );
    }
    expect(errorCaught).to.be.true;
  });
});
