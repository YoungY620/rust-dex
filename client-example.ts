import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";

// 资金池操作示例
export class StakingPoolClient {
  constructor(
    private program: anchor.Program,
    private provider: anchor.AnchorProvider
  ) {}

  // 1. 初始化资金池
  async initializePool(tokenMint: PublicKey, vaultTokenAccount: PublicKey) {
    const [poolPda] = await PublicKey.findProgramAddress(
      [Buffer.from("pool"), tokenMint.toBuffer()],
      this.program.programId
    );

    const tx = await this.program.methods
      .initializePool(tokenMint)
      .accounts({
        pool: poolPda,
        vault: vaultTokenAccount,
        payer: this.provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("资金池初始化成功:", tx);
    return { poolPda, signature: tx };
  }

  // 2. 初始化用户余额账户
  async initializeUserBalance(
    user: Keypair,
    tokenMint: PublicKey
  ) {
    const [userBalancePda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("user_balance"),
        user.publicKey.toBuffer(),
        tokenMint.toBuffer(),
      ],
      this.program.programId
    );

    const tx = await this.program.methods
      .initializeUserBalance(tokenMint)
      .accounts({
        user: user.publicKey,
        userBalance: userBalancePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log("用户余额账户初始化成功:", tx);
    return { userBalancePda, signature: tx };
  }

  // 3. 质押 token
  async deposit(
    user: Keypair,
    tokenMint: PublicKey,
    amount: number
  ) {
    // 计算 PDA 地址
    const [poolPda] = await PublicKey.findProgramAddress(
      [Buffer.from("pool"), tokenMint.toBuffer()],
      this.program.programId
    );

    const [userBalancePda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("user_balance"),
        user.publicKey.toBuffer(),
        tokenMint.toBuffer(),
      ],
      this.program.programId
    );

    // 获取关联 token 账户
    const userTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      user.publicKey
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      poolPda,
      true // 允许 PDA 拥有 token 账户
    );

    const tx = await this.program.methods
      .deposit(tokenMint, new anchor.BN(amount))
      .accounts({
        user: user.publicKey,
        userTokenAccount,
        vaultTokenAccount,
        pool: poolPda,
        userBalance: userBalancePda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log(`用户质押 ${amount} tokens 成功:`, tx);
    return { signature: tx };
  }

  // 4. 取款 token
  async withdraw(
    user: Keypair,
    tokenMint: PublicKey,
    amount: number
  ) {
    // 计算 PDA 地址
    const [poolPda] = await PublicKey.findProgramAddress(
      [Buffer.from("pool"), tokenMint.toBuffer()],
      this.program.programId
    );

    const [userBalancePda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("user_balance"),
        user.publicKey.toBuffer(),
        tokenMint.toBuffer(),
      ],
      this.program.programId
    );

    // 获取关联 token 账户
    const userTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      user.publicKey
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      poolPda,
      true
    );

    const tx = await this.program.methods
      .withdraw(tokenMint, new anchor.BN(amount))
      .accounts({
        user: user.publicKey,
        userTokenAccount,
        vaultTokenAccount,
        pool: poolPda,
        userBalance: userBalancePda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    console.log(`用户取款 ${amount} tokens 成功:`, tx);
    return { signature: tx };
  }

  // 5. 查询资金池信息
  async getPoolInfo(tokenMint: PublicKey) {
    const [poolPda] = await PublicKey.findProgramAddress(
      [Buffer.from("pool"), tokenMint.toBuffer()],
      this.program.programId
    );

    try {
      const poolAccount = await this.program.account.poolAccount.fetch(poolPda);
      return {
        tokenMint: poolAccount.tokenMint,
        vault: poolAccount.vault,
        totalDeposited: poolAccount.totalDeposited.toString(),
        isInitialized: poolAccount.isInitialized,
      };
    } catch (error) {
      console.log("资金池不存在或未初始化");
      return null;
    }
  }

  // 6. 查询用户余额
  async getUserBalance(userPubkey: PublicKey, tokenMint: PublicKey) {
    const [userBalancePda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("user_balance"),
        userPubkey.toBuffer(),
        tokenMint.toBuffer(),
      ],
      this.program.programId
    );

    try {
      const userBalance = await this.program.account.userBalanceAccount.fetch(
        userBalancePda
      );
      return {
        user: userBalance.user,
        tokenMint: userBalance.tokenMint,
        balance: userBalance.balance.toString(),
      };
    } catch (error) {
      console.log("用户余额账户不存在");
      return null;
    }
  }
}

// 使用示例
export async function stakingPoolExample() {
  // 设置连接
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.rustDex;

  // 创建客户端
  const stakingClient = new StakingPoolClient(program, provider);

  // 示例：质押流程
  const tokenMint = new PublicKey("你的token mint地址");
  const user = Keypair.generate();
  const depositAmount = 1000000; // 1 token (假设6位小数)

  try {
    // 1. 初始化资金池（管理员操作，只需要做一次）
    const vaultTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      provider.wallet.publicKey
    );
    await stakingClient.initializePool(tokenMint, vaultTokenAccount);

    // 2. 初始化用户余额账户（用户操作，每个token只需要做一次）
    await stakingClient.initializeUserBalance(user, tokenMint);

    // 3. 质押 token
    await stakingClient.deposit(user, tokenMint, depositAmount);

    // 4. 查询余额
    const balance = await stakingClient.getUserBalance(user.publicKey, tokenMint);
    console.log("用户余额:", balance);

    // 5. 取款 token
    const withdrawAmount = 500000; // 0.5 token
    await stakingClient.withdraw(user, tokenMint, withdrawAmount);

    // 6. 查询最终余额
    const finalBalance = await stakingClient.getUserBalance(user.publicKey, tokenMint);
    console.log("最终余额:", finalBalance);

  } catch (error) {
    console.error("操作失败:", error);
  }
}
