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

describe("rust-dex: deposit", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  
  const program = anchor.workspace.rustDex as Program<RustDex>;
  const provider = anchor.getProvider();

  let mintAuthority: Keypair;
  let mint: PublicKey;
  let userTokenAccount: PublicKey;
  let vaultTokenAccount: PublicKey;
  let user: Keypair;
  let vault: Keypair;
  const depositAmount = 100;

  before(async () => {
    // 初始化测试所需的账户
    mintAuthority = Keypair.generate();
    user = Keypair.generate();
    vault = Keypair.generate();

    // 为用户账户充值
    const signature = await provider.connection.requestAirdrop(
      user.publicKey,
      20 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);

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

    // vault token 账户将由 register_vault_token_ledger 创建
    // 我们需要先注册 vault token ledger 来创建它
    // 创建用户的 token account 
    userTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      user,
      mint,
      user.publicKey
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
    // 注意：vault 账户作为 payer 会支付创建费用
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
  });

  it("Should deposit tokens correctly", async () => {
    // Mint tokens to user token account
    const amount = depositAmount * 10 ** 9;
    await mintTo(
      provider.connection,
      mintAuthority,
      mint,
      userTokenAccount,
      mintAuthority,
      amount
    );

    // Derive PDAs for deposit
    const [vaultTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), mint.toBuffer()],
      program.programId
    );
    const [userTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), mint.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );

    // 获取转账前余额
    const beforeUser = await provider.connection.getTokenAccountBalance(userTokenAccount);
    const beforeVault = await provider.connection.getTokenAccountBalance(vaultTokenAccount);

    // 调用 deposit
    try {
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
    } catch (err: any) {
      if (err instanceof SendTransactionError) {
        console.error("Deposit transaction failed, logs:", err.logs);
      }
      throw err;
    }

    // 获取转账后余额
    const afterUser = await provider.connection.getTokenAccountBalance(userTokenAccount);
    const afterVault = await provider.connection.getTokenAccountBalance(vaultTokenAccount);

    // 验证 balances
    expect(BigInt(afterUser.value.amount)).to.equal(BigInt(beforeUser.value.amount) - BigInt(amount));
    expect(BigInt(afterVault.value.amount)).to.equal(BigInt(beforeVault.value.amount) + BigInt(amount));
  });

  it("Should fail when depositing more than balance", async () => {
    const [vaultTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), mint.toBuffer()],
      program.programId
    );
    const [userTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), mint.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );
    const highAmount = (depositAmount + 1) * 10 ** 9;

    let errorCaught = false;
    try {
      await program.methods.deposit(mint, new anchor.BN(highAmount))
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
    } catch (err) {
      errorCaught = true;
    }
    expect(errorCaught).to.be.true;
  });
  it("Should fail when unauthorized user tries to deposit", async () => {
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
        // Mint tokens to unauthorized user's token account
        const amount = depositAmount * 10 ** 9;
        await mintTo(
          provider.connection,
          mintAuthority,
          mint,
          unauthorizedUserTokenAccount,
          mintAuthority,
          amount
        );
        // Derive PDAs for deposit
        const [vaultTokenLedgerPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_token_ledger"), mint.toBuffer()],
            program.programId
            );
        const [userTokenLedgerPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("individual_token_ledger"), mint.toBuffer(), unauthorizedUser.publicKey.toBuffer()],
            program.programId
        );
        let errorCaught = false;
        try {
            await program.methods.deposit(mint, new anchor.BN(amount))
                .accountsPartial({
                    vaultTokenLedger: vaultTokenLedgerPda,
                    userTokenLedger: userTokenLedgerPda,
                    userTokenAccount: unauthorizedUserTokenAccount,
                    vaultTokenAccount,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    user: unauthorizedUser.publicKey,
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
