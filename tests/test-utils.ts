import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RustDex } from "../target/types/rust_dex";
import { 
  createMint,
  createAssociatedTokenAccount,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";

const LAMPORTS_PER_SOL = anchor.web3.LAMPORTS_PER_SOL;

export async function createFundedUser(provider: anchor.AnchorProvider, solAmount = 20) {
  const user = Keypair.generate();
  const signature = await provider.connection.requestAirdrop(
    user.publicKey,
    solAmount * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(signature);
  return user;
}

export async function createTokenMint(
  connection: anchor.web3.Connection,
  authority: Keypair,
  decimals = 9
) {
  return await createMint(
    connection,
    authority,
    authority.publicKey,
    null,
    decimals
  );
}

export async function createUserTokenAccount(
  connection: anchor.web3.Connection,
  user: Keypair,
  mint: PublicKey
) {
  return await createAssociatedTokenAccount(
    connection,
    user,
    mint,
    user.publicKey
  );
}

export async function registerVaultTokenLedger(
  program: Program<RustDex>,
  vault: Keypair,
  mint: PublicKey
) {
  const [vaultTokenLedgerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_token_ledger"), mint.toBuffer()],
    program.programId
  );

  const [vaultTokenAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_token_account"), mint.toBuffer()],
    program.programId
  );

  const vaultTokenAccountKeypair = Keypair.generate();

  await program.methods
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

  return {
    vaultTokenAccount: vaultTokenAccountKeypair.publicKey,
    vaultTokenLedgerPda
  };
}

export async function registerUser(
  program: Program<RustDex>,
  user: Keypair
) {
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

  await program.methods
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

  return { individualLedgerPda, userOrderbookPda, orderEventsPda };
}

export async function registerUserTokenLedger(
  program: Program<RustDex>,
  user: Keypair,
  mint: PublicKey,
  userTokenAccount: PublicKey
) {
  const [userTokenLedgerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("individual_token_ledger"), mint.toBuffer(), user.publicKey.toBuffer()],
    program.programId
  );

  await program.methods
    .registerUserTokenLedger(mint)
    .accountsPartial({
      userTokenLedger: userTokenLedgerPda,
      mintAccount: mint,
      userTokenAccount,
      user: user.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();

  return userTokenLedgerPda;
}

export async function depositTokens(
  program: Program<RustDex>,
  user: Keypair,
  mint: PublicKey,
  amount: number,
  userTokenAccount: PublicKey,
  vaultTokenAccount: PublicKey,
  vaultTokenLedgerPda: PublicKey,
  userTokenLedgerPda: PublicKey
) {
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
}

export async function placeLimitOrder(
  program: Program<RustDex>,
  fromUser: Keypair,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  side: "buy" | "sell",
  price: number,
  amount: number,
  dexManagerPda: PublicKey,
  buyBaseQueuePda: PublicKey,
  sellBaseQueuePda: PublicKey,
  userEventsPda: PublicKey,
  userBaseTokenLedgerPda: PublicKey,
  userQuoteTokenLedgerPda: PublicKey
) {
  await program.methods
    .placeLimitOrder(baseMint, quoteMint, side, price, new anchor.BN(amount))
    .accountsPartial({
      baseQuoteQueue: buyBaseQueuePda,
      quoteBaseQueue: sellBaseQueuePda,
      dexManager: dexManagerPda,
      orderEvents: userEventsPda,
      userBaseTokenLedger: userBaseTokenLedgerPda,
      userQuoteTokenLedger: userQuoteTokenLedgerPda,
      user: fromUser.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([fromUser])
    .rpc();
}

export async function placeMarketOrder(
  program: Program<RustDex>,
  fromUser: Keypair,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  side: "buy" | "sell",
  amount: number,
  dexManagerPda: PublicKey,
  buyBaseQueuePda: PublicKey,
  sellBaseQueuePda: PublicKey,
  userEventsPda: PublicKey,
  userBaseTokenLedgerPda: PublicKey,
  userQuoteTokenLedgerPda: PublicKey
) {
  await program.methods
    .placeMarketOrder(baseMint, quoteMint, side, new anchor.BN(amount))
    .accountsPartial({
      baseQuoteQueue: buyBaseQueuePda,
      quoteBaseQueue: sellBaseQueuePda,
      dexManager: dexManagerPda,
      orderEvents: userEventsPda,
      userBaseTokenLedger: userBaseTokenLedgerPda,
      userQuoteTokenLedger: userQuoteTokenLedgerPda,
      user: fromUser.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([fromUser])
    .rpc();
}