import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RustDex } from "../target/types/rust_dex";
import { 
  createMint, 
  createAccount, 
  TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddress,
  createAssociatedTokenAccount
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

describe("rust-dex", () => {
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

    // vault token 账户将由程序创建，我们需要生成一个新的 Keypair
    // 但不要重新生成 vault keypair，因为我们已经为它充值了
    // 创建另一个不同的 token account 
    userTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      user,
      mint,
      user.publicKey
    );
  });

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });

  it("Should register vault token ledger", async () => {
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

    console.log("Register vault token ledger transaction signature:", tx);

    // 更新 vaultTokenAccount 变量为实际创建的账户
    vaultTokenAccount = vaultTokenAccountKeypair.publicKey;

    // 验证账户是否正确创建
    const vaultTokenLedgerAccount = await program.account.vaultTokenLedgerAccount.fetch(
      vaultTokenLedgerPda
    );

    // 验证账户数据
    expect(vaultTokenLedgerAccount.totalBalance.toString()).to.equal("0");
    expect(vaultTokenLedgerAccount.mintAccount.toString()).to.equal(mint.toString());
    expect(vaultTokenLedgerAccount.vaultTokenAccount.toString()).to.equal(vaultTokenAccount.toString());
    expect(vaultTokenLedgerAccount.bump).to.be.a('number');

    console.log("Vault Token Ledger Account:", {
      totalBalance: vaultTokenLedgerAccount.totalBalance.toString(),
      mintAccount: vaultTokenLedgerAccount.mintAccount.toString(),
      vaultTokenAccount: vaultTokenLedgerAccount.vaultTokenAccount.toString(),
      bump: vaultTokenLedgerAccount.bump
    });
  });


  it("Should register user ledger", async () => {
    // 计算 PDA 地址
    const [individualLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_ledger"), user.publicKey.toBuffer()],
      program.programId
    );
    const [userOrderbookPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_orderbook"), user.publicKey.toBuffer()],
      program.programId
    );

    // 调用 register_user_ledger 函数
    const tx = await program.methods
      .registerUser()
      .accountsPartial({
        individualLedger: individualLedgerPda,
        userOrderBook: userOrderbookPda,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log("Register user ledger transaction signature:", tx);

    // 验证 IndividualLedgerAccount 是否正确创建
    const userLedgerAccount = await program.account.individualLedgerAccount.fetch(individualLedgerPda);

    expect(userLedgerAccount.bump).to.be.a('number');
    expect(userLedgerAccount.tokens).to.be.an('array').with.lengthOf(32);
    expect(userLedgerAccount.bitmap).to.be.an('array').with.lengthOf(32);
    expect(userLedgerAccount.nextIndex).to.be.a('number');

    console.log("User Ledger Account:", {
      bump: userLedgerAccount.bump,
      tokensLength: userLedgerAccount.tokens.length,
      bitmapLength: userLedgerAccount.bitmap.length,
      nextIndex: userLedgerAccount.nextIndex
    });

    // 验证 UserOrderbook 是否正确创建
    const userOrderbookAccount = await program.account.userOrderbook.fetch(userOrderbookPda);

    expect(userOrderbookAccount.orders).to.be.an('array').with.lengthOf(32);
    expect(userOrderbookAccount.bitmap).to.be.an('array').with.lengthOf(32);
    expect(userOrderbookAccount.nextIndex).to.be.a('number');
    expect(userOrderbookAccount.bump).to.be.a('number');

    console.log("User Orderbook Account:", {
      ordersLength: userOrderbookAccount.orders.length,
      bitmapLength: userOrderbookAccount.bitmap.length,
      nextIndex: userOrderbookAccount.nextIndex,
      bump: userOrderbookAccount.bump
    });
  });

  it("Should register user token ledger", async () => {
    // 计算 PDA 地址
    const [userTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("individual_token_ledger"), mint.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );

    const tx = await program.methods
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

    console.log("Register user token ledger transaction signature:", tx);
    // 验证 IndividualTokenLedgerAccount 是否正确创建
    const userTokenLedgerAccount = await program.account.individualTokenLedgerAccount.fetch(userTokenLedgerPda);
    expect(userTokenLedgerAccount.mintAccount.toString()).to.equal(mint.toString());
    expect(userTokenLedgerAccount.userTokenAccount.toString()).to.equal(userTokenAccount.toString());
    expect(userTokenLedgerAccount.availableBalance.toString()).to.equal("0");
    expect(userTokenLedgerAccount.lockedBalance.toString()).to.equal("0");
    expect(userTokenLedgerAccount.bump).to.be.a('number');
  });
});
