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
  depositTokens,
  placeLimitOrder,
  placeMarketOrder,
  cancelOrder
} from "./test-utils";

describe("rust-dex: cancel-order", () => {
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
  let user1EventsPda: PublicKey;
  let user2EventsPda: PublicKey;
  let user1OrderbookPda: PublicKey;
  let user2OrderbookPda: PublicKey;

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

    [user1EventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user1.publicKey.toBuffer()],
      program.programId
    );

    [user2EventsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_events"), user2.publicKey.toBuffer()],
      program.programId
    );

    [user1OrderbookPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_orderbook"), user1.publicKey.toBuffer()],
      program.programId
    );

    [user2OrderbookPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_orderbook"), user2.publicKey.toBuffer()],
      program.programId
    );

    // Setup DEX environment
    await setupDexEnvironment();
  });

  async function setupDexEnvironment() {
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
      console.log("No existing dex_manager to close:", error.message);
    }
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

    // Register user token ledgers
    await registerUserTokenLedger(program, user1, baseMint, user1BaseTokenAccount);
    await registerUserTokenLedger(program, user1, quoteMint, user1QuoteTokenAccount);
    await registerUserTokenLedger(program, user2, baseMint, user2BaseTokenAccount);
    await registerUserTokenLedger(program, user2, quoteMint, user2QuoteTokenAccount);

    // Deposit tokens
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
  }

  // it("should consume events for a user", async () => {
  //   // 使用新的工具函数发起限价交易
  //   const orders = [
  //     { user: user1, side: "sell", amount: 10 },
  //     { user: user1, side: "sell", amount: 10 },
  //     { user: user1, side: "sell", amount: 10 },
  //     { user: user1, side: "sell", amount: 10 },
  //     // { user: user2, side: "buy", amount: 50 }
  //   ];

  //   for (const order of orders) {
  //     await placeLimitOrder(
  //       program,
  //       order.user,
  //       baseMint,
  //       quoteMint,
  //       order.side,
  //       100,
  //       order.amount,
  //       dexManagerPda,
  //       buyBaseQueuePda,
  //       sellBaseQueuePda,
  //       order.user === user1 ? user1EventsPda : user2EventsPda,
  //       order.user === user1 ? user1BaseTokenLedgerPda : user2BaseTokenLedgerPda,
  //       order.user === user1 ? user1QuoteTokenLedgerPda : user2QuoteTokenLedgerPda,
  //       order.user === user1 ? user1OrderbookPda : user2OrderbookPda
  //     );
  //   }
  //   // check token pair queues
  //   const buyBaseQueue = await program.account.tokenPairAccount.fetch(buyBaseQueuePda);
  //   const sellBaseQueue = await program.account.tokenPairAccount.fetch(sellBaseQueuePda);
  //   console.log("Buy base queue: ", buyBaseQueue);
  //   console.log("Sell base queue: ", sellBaseQueue);
  //   console.log("length of buy base queue: ", buyBaseQueue.orderHeap.nextIndex);
  //   console.log("length of sell base queue: ", sellBaseQueue.orderHeap.nextIndex);
  //   expect(buyBaseQueue.orderHeap.nextIndex.toString()).to.eq("0");
  //   expect(sellBaseQueue.orderHeap.nextIndex.toString()).to.eq("4");
  // });

  it("should cancel an order", async () => {
    // 先下一个限价单
    await placeLimitOrder(
      program,
      user1,
      baseMint,
      quoteMint,
      "sell",
      100,
      5,
      dexManagerPda,
      buyBaseQueuePda,
      sellBaseQueuePda,
      user1EventsPda,
      user1BaseTokenLedgerPda,
      user1QuoteTokenLedgerPda,
      user1OrderbookPda
    );
    await placeLimitOrder(
      program,
      user1,
      baseMint,
      quoteMint,
      "sell",
      200,
      5,
      dexManagerPda,
      buyBaseQueuePda,
      sellBaseQueuePda,
      user1EventsPda,
      user1BaseTokenLedgerPda,
      user1QuoteTokenLedgerPda,
      user1OrderbookPda
    );

    // 检查订单已经创建
    let sellBaseQueue = await program.account.tokenPairAccount.fetch(sellBaseQueuePda);
    const initialOrderCount = sellBaseQueue.orderHeap.nextIndex.toNumber();
    console.log("sellBaseQueue initial order count: ", initialOrderCount);
    console.log("sellBaseQueue: ", sellBaseQueue);
    console.log("orderNode: ", 
      sellBaseQueue.orderHeap.orders[0].id.toString(),
      sellBaseQueue.orderHeap.orders[0].sellQuantity.toString(),
      sellBaseQueue.orderHeap.orders[0].buyQuantity.toString(),
    );
    
    // 获取订单ID (假设是第一个订单，ID为1)
    const orderId = 1;
    
    // check user1's orderbook
    const user1Orderbook = await program.account.userOrderbook.fetch(user1OrderbookPda);
    console.log("user1Orderbook: ", user1Orderbook);
    expect(sellBaseQueue.orderHeap.orders[0].id.toString()).to.equal("1")
    expect(sellBaseQueue.orderHeap.orders[1].id.toString()).to.equal("2")
    console.log("sell base queue before cancel: ", sellBaseQueue);
    
    // 取消订单
    await cancelOrder(
      program,
      user1,
      orderId,
      sellBaseQueuePda,
      user1OrderbookPda
    );

    // 验证订单已被取消
    console.log("sellBaseQueue after cancel: ", sellBaseQueue);
    sellBaseQueue = await program.account.tokenPairAccount.fetch(sellBaseQueuePda);
    expect(sellBaseQueue.orderHeap.nextIndex.add(new anchor.BN(1)).toNumber()).eq(initialOrderCount);
    expect(sellBaseQueue.orderHeap.orders[0].id.toString()).to.equal("2")
  });
});
