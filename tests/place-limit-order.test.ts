import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RustDex } from "../target/types/rust_dex";
import {
    createMint,
    mintTo,
    createAssociatedTokenAccount,
    TOKEN_PROGRAM_ID,
    getAccount
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

describe("rust-dex: place_limit_order", () => {
    // Configure the client to use the local cluster.
    anchor.setProvider(anchor.AnchorProvider.env());

    const program = anchor.workspace.rustDex as Program<RustDex>;
    const provider = anchor.getProvider();

    // 测试账户
    let mintAuthority: Keypair;
    let user1: Keypair;
    let user2: Keypair;
    let vault: Keypair;

    // Token相关
    let baseMint: PublicKey; // 基础代币 (例如: SOL)
    let quoteMint: PublicKey; // 计价代币 (例如: USDC)

    // User1 token accounts
    let user1BaseTokenAccount: PublicKey;
    let user1QuoteTokenAccount: PublicKey;

    // User2 token accounts
    let user2BaseTokenAccount: PublicKey;
    let user2QuoteTokenAccount: PublicKey;

    // Vault token accounts
    let vaultBaseTokenAccount: PublicKey;
    let vaultQuoteTokenAccount: PublicKey;

    // PDAs
    let dexManagerPda: PublicKey;
    let tokenPairPda: PublicKey;
    let oppositePairPda: PublicKey;
    let user1BaseTokenLedgerPda: PublicKey;
    let user1QuoteTokenLedgerPda: PublicKey;
    let user2BaseTokenLedgerPda: PublicKey;
    let user2QuoteTokenLedgerPda: PublicKey;

    const INITIAL_BASE_AMOUNT = 1000 * 10 ** 9; // 1000 base tokens
    const INITIAL_QUOTE_AMOUNT = 10000 * 10 ** 6; // 10000 quote tokens (USDC format)
    const DEPOSIT_BASE_AMOUNT = 500 * 10 ** 9; // 500 base tokens to deposit
    const DEPOSIT_QUOTE_AMOUNT = 5000 * 10 ** 6; // 5000 quote tokens to deposit

    before(async () => {
        console.log("Setting up test environment...");

        // 初始化测试账户
        mintAuthority = Keypair.generate();
        user1 = Keypair.generate();
        user2 = Keypair.generate();
        vault = Keypair.generate();

        // 为所有账户充值 SOL
        const accounts = [mintAuthority, user1, user2, vault];
        for (const account of accounts) {
            const signature = await provider.connection.requestAirdrop(
                account.publicKey,
                20 * anchor.web3.LAMPORTS_PER_SOL
            );
            await provider.connection.confirmTransaction(signature);
        }

        // 创建两个代币铸造账户
        baseMint = await createMint(
            provider.connection,
            mintAuthority,
            mintAuthority.publicKey,
            null,
            9 // 基础代币使用9位小数
        );

        quoteMint = await createMint(
            provider.connection,
            mintAuthority,
            mintAuthority.publicKey,
            null,
            6 // 计价代币使用6位小数 (类似USDC)
        );

        console.log("Base mint:", baseMint.toString());
        console.log("Quote mint:", quoteMint.toString());

        // 为用户创建关联代币账户
        user1BaseTokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            user1,
            baseMint,
            user1.publicKey
        );

        user1QuoteTokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            user1,
            quoteMint,
            user1.publicKey
        );

        user2BaseTokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            user2,
            baseMint,
            user2.publicKey
        );

        user2QuoteTokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            user2,
            quoteMint,
            user2.publicKey
        );

        // 为用户铸造代币
        await mintTo(
            provider.connection,
            mintAuthority,
            baseMint,
            user1BaseTokenAccount,
            mintAuthority,
            INITIAL_BASE_AMOUNT
        );

        await mintTo(
            provider.connection,
            mintAuthority,
            quoteMint,
            user1QuoteTokenAccount,
            mintAuthority,
            INITIAL_QUOTE_AMOUNT
        );

        await mintTo(
            provider.connection,
            mintAuthority,
            baseMint,
            user2BaseTokenAccount,
            mintAuthority,
            INITIAL_BASE_AMOUNT
        );

        await mintTo(
            provider.connection,
            mintAuthority,
            quoteMint,
            user2QuoteTokenAccount,
            mintAuthority,
            INITIAL_QUOTE_AMOUNT
        );

        console.log("Initial token minting completed");

        // 计算所有需要的PDA地址
        [dexManagerPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("dex_manager")],
            program.programId
        );

        [tokenPairPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("token_pair"), baseMint.toBuffer(), quoteMint.toBuffer()],
            program.programId
        );

        [oppositePairPda] = PublicKey.findProgramAddressSync(
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

        console.log("PDA addresses calculated");
    });

    it("Initialize DEX manager", async () => {
        const tx = await program.methods.initialize()
            .accountsPartial({
                dexManager: dexManagerPda,
                user: user1.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();

        console.log("Initialize transaction signature:", tx);

        // 验证初始化
        const dexManager = await program.account.dexManager.fetch(dexManagerPda);
        expect(dexManager.sequenceNumber.toString()).to.equal("0");
        expect(dexManager.bump).to.be.a('number');
    });

    it("Register vault token ledgers for both tokens", async () => {
        // 注册基础代币的vault
        const [vaultBaseTokenLedgerPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_token_ledger"), baseMint.toBuffer()],
            program.programId
        );

        const [vaultBaseTokenAuthorityPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_token_account"), baseMint.toBuffer()],
            program.programId
        );

        const vaultBaseTokenAccountKeypair = Keypair.generate();
        vaultBaseTokenAccount = vaultBaseTokenAccountKeypair.publicKey;

        const tx1 = await program.methods
            .registerVaultTokenLedger()
            .accountsPartial({
                vaultTokenLedger: vaultBaseTokenLedgerPda,
                vaultTokenAuthority: vaultBaseTokenAuthorityPda,
                mintAccount: baseMint,
                vaultTokenAccount: vaultBaseTokenAccount,
                user: vault.publicKey,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([vault, vaultBaseTokenAccountKeypair])
            .rpc();

        console.log("Register base vault token ledger tx:", tx1);

        // 注册计价代币的vault
        const [vaultQuoteTokenLedgerPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_token_ledger"), quoteMint.toBuffer()],
            program.programId
        );

        const [vaultQuoteTokenAuthorityPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_token_account"), quoteMint.toBuffer()],
            program.programId
        );

        const vaultQuoteTokenAccountKeypair = Keypair.generate();
        vaultQuoteTokenAccount = vaultQuoteTokenAccountKeypair.publicKey;

        const tx2 = await program.methods
            .registerVaultTokenLedger()
            .accountsPartial({
                vaultTokenLedger: vaultQuoteTokenLedgerPda,
                vaultTokenAuthority: vaultQuoteTokenAuthorityPda,
                mintAccount: quoteMint,
                vaultTokenAccount: vaultQuoteTokenAccount,
                user: vault.publicKey,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([vault, vaultQuoteTokenAccountKeypair])
            .rpc();

        console.log("Register quote vault token ledger tx:", tx2);
    });

    it("Register token pair", async () => {
        const tx = await program.methods
            .registerTokenPair(baseMint, quoteMint)
            .accountsPartial({
                user: user1.publicKey,
                systemProgram: SystemProgram.programId,
                tokenPair: tokenPairPda,
                oppositePair: oppositePairPda,
            })
            .signers([user1])
            .rpc();

        console.log("Register token pair transaction signature:", tx);

        // 验证交易对注册
        const tokenPairAccount = await program.account.tokenPairAccount.fetch(tokenPairPda);
        expect(tokenPairAccount.buyToken.toString()).to.equal(baseMint.toString());
        expect(tokenPairAccount.sellToken.toString()).to.equal(quoteMint.toString());
    });

    it("Register users", async () => {
        // 注册user1
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

        const tx1 = await program.methods
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

        console.log("Register user1 transaction signature:", tx1);

        // 注册user2
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

        const tx2 = await program.methods
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

        console.log("Register user2 transaction signature:", tx2);
    });

    it("Register user token ledgers", async () => {
        // 为user1注册两个代币的账本
        const tx1 = await program.methods
            .registerUserTokenLedger(baseMint)
            .accountsPartial({
                userTokenLedger: user1BaseTokenLedgerPda,
                mintAccount: baseMint,
                userTokenAccount: user1BaseTokenAccount,
                user: user1.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();

        const tx2 = await program.methods
            .registerUserTokenLedger(quoteMint)
            .accountsPartial({
                userTokenLedger: user1QuoteTokenLedgerPda,
                mintAccount: quoteMint,
                userTokenAccount: user1QuoteTokenAccount,
                user: user1.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();

        // 为user2注册两个代币的账本
        const tx3 = await program.methods
            .registerUserTokenLedger(baseMint)
            .accountsPartial({
                userTokenLedger: user2BaseTokenLedgerPda,
                mintAccount: baseMint,
                userTokenAccount: user2BaseTokenAccount,
                user: user2.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([user2])
            .rpc();

        const tx4 = await program.methods
            .registerUserTokenLedger(quoteMint)
            .accountsPartial({
                userTokenLedger: user2QuoteTokenLedgerPda,
                mintAccount: quoteMint,
                userTokenAccount: user2QuoteTokenAccount,
                user: user2.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([user2])
            .rpc();

        console.log("User token ledger registration completed");
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

        const [vaultBaseTokenAuthorityPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_token_account"), baseMint.toBuffer()],
            program.programId
        );

        const [vaultQuoteTokenAuthorityPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_token_account"), quoteMint.toBuffer()],
            program.programId
        );

        // User1存入基础代币
        const tx1 = await program.methods
            .deposit(baseMint, new anchor.BN(DEPOSIT_BASE_AMOUNT))
            .accountsPartial({
                userTokenLedger: user1BaseTokenLedgerPda,
                vaultTokenLedger: vaultBaseTokenLedgerPda,
                userTokenAccount: user1BaseTokenAccount,
                vaultTokenAccount: vaultBaseTokenAccount,
                user: user1.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([user1])
            .rpc();

        // User1存入计价代币
        const tx2 = await program.methods
            .deposit(quoteMint, new anchor.BN(DEPOSIT_QUOTE_AMOUNT))
            .accountsPartial({
                userTokenLedger: user1QuoteTokenLedgerPda,
                vaultTokenLedger: vaultQuoteTokenLedgerPda,
                userTokenAccount: user1QuoteTokenAccount,
                vaultTokenAccount: vaultQuoteTokenAccount,
                user: user1.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([user1])
            .rpc();

        // User2存入基础代币
        const tx3 = await program.methods
            .deposit(baseMint, new anchor.BN(DEPOSIT_BASE_AMOUNT))
            .accountsPartial({
                userTokenLedger: user2BaseTokenLedgerPda,
                vaultTokenLedger: vaultBaseTokenLedgerPda,
                userTokenAccount: user2BaseTokenAccount,
                vaultTokenAccount: vaultBaseTokenAccount,
                user: user2.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([user2])
            .rpc();

        // User2存入计价代币
        const tx4 = await program.methods
            .deposit(quoteMint, new anchor.BN(DEPOSIT_QUOTE_AMOUNT))
            .accountsPartial({
                userTokenLedger: user2QuoteTokenLedgerPda,
                vaultTokenLedger: vaultQuoteTokenLedgerPda,
                userTokenAccount: user2QuoteTokenAccount,
                vaultTokenAccount: vaultQuoteTokenAccount,
                user: user2.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([user2])
            .rpc();

        console.log("All deposits completed");

        // 验证存款
        const user1BaseBalance = await program.account.individualTokenLedgerAccount.fetch(user1BaseTokenLedgerPda);
        const user1QuoteBalance = await program.account.individualTokenLedgerAccount.fetch(user1QuoteTokenLedgerPda);

        expect(user1BaseBalance.availableBalance.toString()).to.equal(DEPOSIT_BASE_AMOUNT.toString());
        expect(user1QuoteBalance.availableBalance.toString()).to.equal(DEPOSIT_QUOTE_AMOUNT.toString());

        console.log("User1 balances verified:", {
            base: user1BaseBalance.availableBalance.toString(),
            quote: user1QuoteBalance.availableBalance.toString()
        });
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

        const tx = await program.methods
            .placeLimitOrder(baseMint, quoteMint, "buy", orderPrice, new anchor.BN(orderAmount))
            .accountsPartial({
                buyBaseQueue: tokenPairPda,
                sellBaseQueue: oppositePairPda,
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
        const orderEvents = await program.account.eventList.fetch(orderEventsPda);
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
                buyBaseQueue: tokenPairPda,
                sellBaseQueue: oppositePairPda,
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
        const [orderEventsPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order_events"), user1.publicKey.toBuffer()],
            program.programId
        );

        const tx = await program.methods
            .placeLimitOrder(baseMint, quoteMint, "buy", higherPrice, new anchor.BN(matchAmount))
            .accountsPartial({
                buyBaseQueue: tokenPairPda,
                sellBaseQueue: oppositePairPda,
                dexManager: dexManagerPda,
                orderEvents: orderEventsPda,
                userBaseTokenLedger: user1BaseTokenLedgerPda,
                userQuoteTokenLedger: user1QuoteTokenLedgerPda,
                user: user1.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([user1])
            .rpc();

        console.log("Higher price buy order placed, transaction signature:", tx);

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
        const orderEvents = await program.account.eventList.fetch(orderEventsPda);
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
        let orderEventsTx = null;

        try {
            orderEventsTx = await program.methods
                .placeLimitOrder(baseMint, quoteMint, "buy", orderPrice, new anchor.BN(excessiveAmount))
                .accountsPartial({
                    buyBaseQueue: tokenPairPda,
                    sellBaseQueue: oppositePairPda,
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
        let orderEventsTx = null;

        try {
            orderEventsTx = await program.methods
                .placeLimitOrder(baseMint, quoteMint, "invalid_side", orderPrice, new anchor.BN(orderAmount))
                .accountsPartial({
                    buyBaseQueue: tokenPairPda,
                    sellBaseQueue: oppositePairPda,
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
