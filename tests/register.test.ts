import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RustDex } from "../target/types/rust_dex";
import { expect } from "chai";
import {
  createFundedUser,
  createTokenMint,
  createUserTokenAccount,
  registerVaultTokenLedger,
  registerUser,
  registerUserTokenLedger
} from "./test-utils";
import { PublicKey, Keypair, SendTransactionError } from "@solana/web3.js";

describe("rust-dex", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.rustDex as Program<RustDex>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  let mint: PublicKey;
  let user: Keypair;
  let vault: Keypair;
  let userTokenAccount: PublicKey;
  let vaultTokenAccount: PublicKey;

  before(async () => {
    const mintAuthority = await createFundedUser(provider);
    user = await createFundedUser(provider);
    vault = await createFundedUser(provider);

    mint = await createTokenMint(provider.connection, mintAuthority);
    userTokenAccount = await createUserTokenAccount(provider.connection, user, mint);
    
    const { vaultTokenAccount: vaultTokenAcc } = await registerVaultTokenLedger(program, vault, mint);
    vaultTokenAccount = vaultTokenAcc;
    
    await registerUser(program, user);
  });

  it("Should register vault token ledger", async () => {
    const [vaultTokenLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_ledger"), mint.toBuffer()],
      program.programId
    );

    const vaultTokenLedgerAccount = await program.account.vaultTokenLedgerAccount.fetch(vaultTokenLedgerPda);
    
    expect(vaultTokenLedgerAccount.totalBalance.toString()).to.equal("0");
    expect(vaultTokenLedgerAccount.mintAccount.toString()).to.equal(mint.toString());
    expect(vaultTokenLedgerAccount.vaultTokenAccount.toString()).to.equal(vaultTokenAccount.toString());
    expect(vaultTokenLedgerAccount.bump).to.be.a('number');
  });

  it("Should register user ledger", async () => {
    const [individualLedgerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_ledger"), user.publicKey.toBuffer()],
      program.programId
    );

    const userLedgerAccount = await program.account.individualLedgerAccount.fetch(individualLedgerPda);

    expect(userLedgerAccount.bump).to.be.a('number');
    expect(userLedgerAccount.tokens).to.be.an('array').with.lengthOf(32);
    expect(userLedgerAccount.bitmap).to.be.an('array').with.lengthOf(32);
    expect(userLedgerAccount.nextIndex).to.be.a('number');
  });

  it("Should register user token ledger", async () => {
    const userTokenLedgerPda = await registerUserTokenLedger(program, user, mint, userTokenAccount);
    
    const userTokenLedgerAccount = await program.account.individualTokenLedgerAccount.fetch(userTokenLedgerPda);
    
    expect(userTokenLedgerAccount.mintAccount.toString()).to.equal(mint.toString());
    expect(userTokenLedgerAccount.userTokenAccount.toString()).to.equal(userTokenAccount.toString());
    expect(userTokenLedgerAccount.availableBalance.toString()).to.equal("0");
    expect(userTokenLedgerAccount.lockedBalance.toString()).to.equal("0");
    expect(userTokenLedgerAccount.bump).to.be.a('number');
  });
});
