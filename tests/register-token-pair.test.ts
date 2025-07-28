import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RustDex } from "../target/types/rust_dex";
import { 
  createMint,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

describe("rust-dex: register_token_pair", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.rustDex as Program<RustDex>;
  const provider = anchor.getProvider();

  let user: Keypair;
  let mint1: PublicKey;
  let mint2: PublicKey;
  let mintAuthority: Keypair;

  before(async () => {
    // 初始化测试所需的账户
    user = Keypair.generate();
    mintAuthority = Keypair.generate();

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

    // 创建两个 mint 账户
    mint1 = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      9 // 小数位数
    );

    mint2 = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      9 // 小数位数
    );
  });

  it("Is initialized!", async () => {
    // 计算 dex_manager PDA
    const [dexManagerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("dex_manager")],
      program.programId
    );

    // 首先尝试关闭可能存在的 dex_manager 账户
    try {
      await program.methods.closeDexManager()
        .accountsPartial({
          dexManager: dexManagerPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      console.log("Closed existing dex_manager account");
    } catch (error) {
      console.log("No existing dex_manager to close:", error.message);
    }

    // 现在初始化新的 dex_manager
    const tx = await program.methods.initialize()
      .accountsPartial({
        dexManager: dexManagerPda,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
    console.log("Your transaction signature", tx);
  });

  it("Should register token pair", async () => {
    // 计算 PDA 地址
    const [tokenPairPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_pair"), mint1.toBuffer(), mint2.toBuffer()],
      program.programId
    );

    const [oppositePairPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_pair"), mint2.toBuffer(), mint1.toBuffer()],
      program.programId
    );
    console.log("Token Pair PDA:", tokenPairPda.toString());
    console.log("Opposite Pair PDA:", oppositePairPda.toString());

    // 调用 register_token_pair 函数
    const tx = await program.methods
      .registerTokenPair(mint1, mint2)
      .accountsPartial({
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
        tokenPair: tokenPairPda,
        oppositePair: oppositePairPda,
      })
      .signers([user])
      .rpc();

    console.log("Register token pair transaction signature:", tx);

    // 验证 TokenPairAccount 是否正确创建
    const tokenPairAccount = await program.account.tokenPairAccount.fetch(tokenPairPda);
    
    expect(tokenPairAccount.buyToken.toString()).to.equal(mint1.toString());
    expect(tokenPairAccount.sellToken.toString()).to.equal(mint2.toString());
    // expect(tokenPairAccount.bump.toNumber()).to.be.a('number');

    console.log("Token Pair Account:", {
      buyToken: tokenPairAccount.buyToken.toString(),
      sellToken: tokenPairAccount.sellToken.toString(),
      bump: tokenPairAccount.bump
    });

    // 验证 opposite TokenPairAccount 是否正确创建
    const oppositePairAccount = await program.account.tokenPairAccount.fetch(oppositePairPda);

    expect(oppositePairAccount.buyToken.toString()).to.equal(mint2.toString());
    expect(oppositePairAccount.sellToken.toString()).to.equal(mint1.toString());
    expect(oppositePairAccount.bump).to.be.a('number');

    console.log("Opposite Token Pair Account:", {
      buyToken: oppositePairAccount.buyToken.toString(),
      sellToken: oppositePairAccount.sellToken.toString(),
      bump: oppositePairAccount.bump
    });
  });

  // it("Should fail when same tokens are used as pair", async () => {
  //   let errorCaught = false;
  //   try {
  //     // 尝试使用相同的token注册交易对
  //     const [tokenPairPda] = PublicKey.findProgramAddressSync(
  //       [Buffer.from("token_pair"), mint1.toBuffer(), mint1.toBuffer()],
  //       program.programId
  //     );

  //     const [oppositePairPda] = PublicKey.findProgramAddressSync(
  //       [Buffer.from("token_pair"), mint1.toBuffer(), mint1.toBuffer()],
  //       program.programId
  //     );

  //     await program.methods
  //       .registerTokenPair(mint1, mint1)
  //       .accountsPartial({
  //         user: user.publicKey,
  //         systemProgram: SystemProgram.programId,
  //         tokenPair: tokenPairPda,
  //         oppositePair: oppositePairPda,
  //       })
  //       .signers([user])
  //       .rpc();
  //   } catch (err) {
  //     errorCaught = true;
  //   }
  //   expect(errorCaught).to.be.true;
  // });
});