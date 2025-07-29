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

describe("rust-dex: consume_events", () => {
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

    // Setup DEX environment
    await setupDexEnvironment();
  });

  async function setupDexEnvironment() {
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

  async function place_limit_order(
    from_user: Keypair,
    base_mint: PublicKey,
    quote_mint: PublicKey,
    side: "buy" | "sell",
    price: number,
    amount: number
  ) {
    await program.methods
      .placeLimitOrder(base_mint, quote_mint, side, price, new anchor.BN(amount))
      .accountsPartial({
        baseQuoteQueue: buyBaseQueuePda,
        quoteBaseQueue: sellBaseQueuePda,
        dexManager: dexManagerPda,
        orderEvents: from_user === user1 ? user1EventsPda : user2EventsPda,
        userBaseTokenLedger: from_user === user1 ? user1BaseTokenLedgerPda : user2BaseTokenLedgerPda,
        userQuoteTokenLedger: from_user === user1 ? user1QuoteTokenLedgerPda : user2QuoteTokenLedgerPda,
        user: from_user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([from_user])
      .rpc();
  }

  async function place_market_order(
    from_user: Keypair,
    base_mint: PublicKey,
    quote_mint: PublicKey,
    side: "buy" | "sell",
    amount: number
  ) {
    await program.methods
      .placeMarketOrder(base_mint, quote_mint, side, new anchor.BN(amount))
      .accountsPartial({
        baseQuoteQueue: buyBaseQueuePda,
        quoteBaseQueue: sellBaseQueuePda,
        dexManager: dexManagerPda,
        orderEvents: from_user === user1 ? user1EventsPda : user2EventsPda,
        userBaseTokenLedger: from_user === user1 ? user1BaseTokenLedgerPda : user2BaseTokenLedgerPda,
        userQuoteTokenLedger: from_user === user1 ? user1QuoteTokenLedgerPda : user2QuoteTokenLedgerPda,
        user: from_user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([from_user])
      .rpc();
  }
  

  async function consume_events(user: Keypair) {
    // 根据消费事件的用户，选出对应的 PDA 和 "opposite" 公钥
    const oppositeKey = user === user1 ? user2.publicKey : user1.publicKey;
    const eventListPda = user === user1 ? user1EventsPda : user2EventsPda;
    
    // 根据事件列表中的token类型来确定正确的账户映射
    const events = await program.account.eventList.fetch(eventListPda);
    const tokenBuy = events.tokenBuy;
    const tokenSell = events.tokenSell;
    
    // 确定用户的buy和sell ledger（基于实际的token类型）
    let userBuyLedger: PublicKey;
    let userSellLedger: PublicKey;
    let oppBuyLedger: PublicKey;
    let oppSellLedger: PublicKey;
    
    if (tokenBuy.equals(baseMint)) {
      // tokenBuy是baseMint，tokenSell是quoteMint
      userBuyLedger = user === user1 ? user1BaseTokenLedgerPda : user2BaseTokenLedgerPda;
      userSellLedger = user === user1 ? user1QuoteTokenLedgerPda : user2QuoteTokenLedgerPda;
      oppBuyLedger = user === user1 ? user2QuoteTokenLedgerPda : user1QuoteTokenLedgerPda;
      oppSellLedger = user === user1 ? user2BaseTokenLedgerPda : user1BaseTokenLedgerPda;
    } else {
      // tokenBuy是quoteMint，tokenSell是baseMint
      userBuyLedger = user === user1 ? user1QuoteTokenLedgerPda : user2QuoteTokenLedgerPda;
      userSellLedger = user === user1 ? user1BaseTokenLedgerPda : user2BaseTokenLedgerPda;
      oppBuyLedger = user === user1 ? user2BaseTokenLedgerPda : user1BaseTokenLedgerPda;
      oppSellLedger = user === user1 ? user2QuoteTokenLedgerPda : user1QuoteTokenLedgerPda;
    }

    // check pre commit states
    let userIncomeLedgerAccount = await program.account.individualTokenLedgerAccount.fetch(userBuyLedger);
    let userOutcomeLedgerAccount = await program.account.individualTokenLedgerAccount.fetch(userSellLedger);
    let oppIncomeLedgerAccount = await program.account.individualTokenLedgerAccount.fetch(oppBuyLedger);
    let oppOutcomeLedgerAccount = await program.account.individualTokenLedgerAccount.fetch(oppSellLedger);
  
    // check locked balances
    // user in 0, out 5000, opp in 0, out 40
    expect(userIncomeLedgerAccount.lockedBalance.toNumber()).to.equal(0);
    expect(userOutcomeLedgerAccount.lockedBalance.toNumber()).to.equal(5000);
    expect(oppIncomeLedgerAccount.lockedBalance.toNumber()).to.equal(0);
    expect(oppOutcomeLedgerAccount.lockedBalance.toNumber()).to.equal(40);
    // record current available balances
    const userAvailableIn = userIncomeLedgerAccount.availableBalance.toNumber();
    const userAvailableOut = userOutcomeLedgerAccount.availableBalance.toNumber();
    const oppAvailableIn = oppIncomeLedgerAccount.availableBalance.toNumber();
    const oppAvailableOut = oppOutcomeLedgerAccount.availableBalance.toNumber();

    await program.methods
      .consumeEvents(oppositeKey)
      .accountsPartial({
        eventList: eventListPda,
        userTokenIncomeLedger: userBuyLedger,
        userTokenOutcomeLedger: userSellLedger,
        oppositeUserTokenIncomeLedger: oppBuyLedger,
        oppositeUserTokenOutcomeLedger: oppSellLedger,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    
    // check post commit states
    // locked balance: user out 4000, opp out 30
    userIncomeLedgerAccount = await program.account.individualTokenLedgerAccount.fetch(userBuyLedger);
    userOutcomeLedgerAccount = await program.account.individualTokenLedgerAccount.fetch(userSellLedger);
    oppIncomeLedgerAccount = await program.account.individualTokenLedgerAccount.fetch(oppBuyLedger);
    oppOutcomeLedgerAccount = await program.account.individualTokenLedgerAccount.fetch(oppSellLedger);
    expect(userIncomeLedgerAccount.lockedBalance.toNumber()).to.equal(0);
    expect(userOutcomeLedgerAccount.lockedBalance.toNumber()).to.equal(4000);
    expect(oppIncomeLedgerAccount.lockedBalance.toNumber()).to.equal(0);
    expect(oppOutcomeLedgerAccount.lockedBalance.toNumber()).to.equal(30);
    // available balance: user in plus 10, opp in plus 1000
    expect(userIncomeLedgerAccount.availableBalance.toNumber()).to.equal(userAvailableIn + 10);
    expect(userOutcomeLedgerAccount.availableBalance.toNumber()).to.equal(userAvailableOut);
    expect(oppIncomeLedgerAccount.availableBalance.toNumber()).to.equal(oppAvailableIn + 1000);
    expect(oppOutcomeLedgerAccount.availableBalance.toNumber()).to.equal(oppAvailableOut);
  }

  it("should consume events for a user", async () => {
    // Place limit orders
    await place_limit_order(user1, baseMint, quoteMint, "sell", 100, 10);
    await place_limit_order(user1, baseMint, quoteMint, "sell", 100, 10);
    await place_limit_order(user1, baseMint, quoteMint, "sell", 100, 10);
    await place_limit_order(user1, baseMint, quoteMint, "sell", 100, 10);
    await place_limit_order(user2, baseMint, quoteMint, "buy", 100, 50);
    
    // get the events for user2
    const events = await program.account.eventList.fetch(user2EventsPda);
    // console.log(events);
    expect(events.length.toString()).to.equal(new anchor.BN(4).toString());   // there should be 4 events for user2

    // Consume events for user2
    await consume_events(user2);

    const events2 = await program.account.eventList.fetch(user2EventsPda);
    // console.log(events2);
    expect(events2.length.toString()).to.equal(new anchor.BN(3).toString()); 
  });

});
