import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram,
  LAMPORTS_PER_SOL,
  Connection,
  clusterApiUrl
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
  getMinimumBalanceForRentExemptMint,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount
} from "@solana/spl-token";

describe("Token Operations", () => {
  // 配置provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  
  // 生成mint keypair
  const mintKeypair = Keypair.generate();
  
  // 创建两个用户账户
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();
  
  let user1TokenAccount: PublicKey;
  let user2TokenAccount: PublicKey;
  
  const mintAmount = 1000000; // 1,000,000 tokens (考虑decimals)
  const transferAmount = 500000; // 500,000 tokens 转账数量

  it("1. 发行一个token", async () => {
    console.log("正在发行token...");
    console.log("Mint公钥:", mintKeypair.publicKey.toString());
    
    // 计算租金
    const rentExemption = await getMinimumBalanceForRentExemptMint(connection);
    
    // 创建mint账户的交易
    const createMintTx = new anchor.web3.Transaction().add(
      // 创建mint账户
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports: rentExemption,
        programId: TOKEN_PROGRAM_ID,
      }),
      // 初始化mint
      createInitializeMintInstruction(
        mintKeypair.publicKey,  // mint
        6,                      // decimals (6位小数)
        wallet.publicKey,       // mint authority
        null,                   // freeze authority (设为null表示不可冻结)
        TOKEN_PROGRAM_ID
      )
    );
    
    // 发送交易
    const signature = await anchor.web3.sendAndConfirmTransaction(
      connection,
      createMintTx,
      [wallet.payer, mintKeypair]
    );
    
    console.log("Token发行成功！交易签名:", signature);
    console.log("Token mint地址:", mintKeypair.publicKey.toString());
  });

  it("2. 铸造一定量的token", async () => {
    console.log("正在铸造token...");
    
    // 获取或创建wallet的关联token账户
    const walletTokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      wallet.publicKey
    );
    
    // 创建关联token账户和铸造token的交易
    const mintToTx = new anchor.web3.Transaction().add(
      // 创建关联token账户
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,        // payer
        walletTokenAccount,      // associatedToken
        wallet.publicKey,        // owner
        mintKeypair.publicKey    // mint
      ),
      // 铸造token到该账户
      createMintToInstruction(
        mintKeypair.publicKey,   // mint
        walletTokenAccount,      // destination
        wallet.publicKey,        // authority
        mintAmount               // amount
      )
    );
    
    const signature = await anchor.web3.sendAndConfirmTransaction(
      connection,
      mintToTx,
      [wallet.payer]
    );
    
    console.log("Token铸造成功！交易签名:", signature);
    console.log("铸造数量:", mintAmount / 1000000, "tokens (考虑6位小数)");
    console.log("钱包token账户:", walletTokenAccount.toString());
    
    // 验证铸造结果
    const accountInfo = await getAccount(connection, walletTokenAccount);
    console.log("账户余额:", Number(accountInfo.amount) / 1000000, "tokens");
  });

  it("3. 创建两个账户", async () => {
    console.log("正在创建两个用户账户...");
    
    // 为用户账户充值SOL以支付交易费用
    const airdropAmount = 2 * LAMPORTS_PER_SOL; // 2 SOL
    
    // 为user1充值SOL
    const airdrop1Signature = await connection.requestAirdrop(
      user1.publicKey,
      airdropAmount
    );
    await connection.confirmTransaction(airdrop1Signature);
    
    // 为user2充值SOL
    const airdrop2Signature = await connection.requestAirdrop(
      user2.publicKey,
      airdropAmount
    );
    await connection.confirmTransaction(airdrop2Signature);
    
    console.log("User1公钥:", user1.publicKey.toString());
    console.log("User2公钥:", user2.publicKey.toString());
    
    // 获取用户的关联token账户地址
    user1TokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      user1.publicKey
    );
    
    user2TokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      user2.publicKey
    );
    
    // 创建user1的token账户
    const createUser1AccountTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        user1.publicKey,         // payer
        user1TokenAccount,       // associatedToken
        user1.publicKey,         // owner
        mintKeypair.publicKey    // mint
      )
    );
    
    const user1AccountSignature = await anchor.web3.sendAndConfirmTransaction(
      connection,
      createUser1AccountTx,
      [user1]
    );
    
    // 创建user2的token账户
    const createUser2AccountTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        user2.publicKey,         // payer
        user2TokenAccount,       // associatedToken
        user2.publicKey,         // owner
        mintKeypair.publicKey    // mint
      )
    );
    
    const user2AccountSignature = await anchor.web3.sendAndConfirmTransaction(
      connection,
      createUser2AccountTx,
      [user2]
    );
    
    console.log("User1 token账户创建成功:", user1TokenAccount.toString());
    console.log("User2 token账户创建成功:", user2TokenAccount.toString());
    console.log("User1账户创建交易:", user1AccountSignature);
    console.log("User2账户创建交易:", user2AccountSignature);
  });

  it("4. 实现两个账户之间的token转账", async () => {
    console.log("正在执行token转账...");
    
    // 首先将一些token从wallet转给user1
    const walletTokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      wallet.publicKey
    );
    
    console.log("步骤1: 从钱包转账给User1");
    const transferToUser1Tx = new anchor.web3.Transaction().add(
      createTransferInstruction(
        walletTokenAccount,      // source
        user1TokenAccount,       // destination
        wallet.publicKey,        // owner
        transferAmount           // amount
      )
    );
    
    const transferToUser1Signature = await anchor.web3.sendAndConfirmTransaction(
      connection,
      transferToUser1Tx,
      [wallet.payer]
    );
    
    console.log("转账给User1成功，交易签名:", transferToUser1Signature);
    
    // 检查User1余额
    const user1Balance = await getAccount(connection, user1TokenAccount);
    console.log("User1余额:", Number(user1Balance.amount) / 1000000, "tokens");
    
    // 现在从user1转账给user2
    console.log("步骤2: 从User1转账给User2");
    const transferToUser2Amount = 250000; // 250,000 tokens
    
    const transferToUser2Tx = new anchor.web3.Transaction().add(
      createTransferInstruction(
        user1TokenAccount,       // source
        user2TokenAccount,       // destination
        user1.publicKey,         // owner
        transferToUser2Amount    // amount
      )
    );
    
    const transferToUser2Signature = await anchor.web3.sendAndConfirmTransaction(
      connection,
      transferToUser2Tx,
      [user1]
    );
    
    console.log("User1转账给User2成功，交易签名:", transferToUser2Signature);
    
    // 检查最终余额
    const finalUser1Balance = await getAccount(connection, user1TokenAccount);
    const finalUser2Balance = await getAccount(connection, user2TokenAccount);
    
    console.log("\n=== 最终余额 ===");
    console.log("User1最终余额:", Number(finalUser1Balance.amount) / 1000000, "tokens");
    console.log("User2最终余额:", Number(finalUser2Balance.amount) / 1000000, "tokens");
    
    // 验证转账是否正确
    const expectedUser1Balance = (transferAmount - transferToUser2Amount) / 1000000;
    const expectedUser2Balance = transferToUser2Amount / 1000000;
    
    console.log("预期User1余额:", expectedUser1Balance, "tokens");
    console.log("预期User2余额:", expectedUser2Balance, "tokens");
    
    // 简单验证
    if (Number(finalUser1Balance.amount) === transferAmount - transferToUser2Amount) {
      console.log("✅ User1余额验证通过");
    } else {
      console.log("❌ User1余额验证失败");
    }
    
    if (Number(finalUser2Balance.amount) === transferToUser2Amount) {
      console.log("✅ User2余额验证通过");
    } else {
      console.log("❌ User2余额验证失败");
    }
    
    console.log("\n=== Token操作完成 ===");
    console.log("Token地址:", mintKeypair.publicKey.toString());
    console.log("User1账户:", user1TokenAccount.toString());
    console.log("User2账户:", user2TokenAccount.toString());
  });
});