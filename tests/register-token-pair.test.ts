import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RustDex } from "../target/types/rust_dex";
import { expect } from "chai";
import {
  createFundedUser,
  createTokenMint,
  registerVaultTokenLedger,
  registerUser,
  registerUserTokenLedger
} from "./test-utils";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";

describe("rust-dex: register_token_pair", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.rustDex as Program<RustDex>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  let user: Keypair;
  let mint1: PublicKey;
  let mint2: PublicKey;
  let mintAuthority: Keypair;

  before(async () => {
    mintAuthority = Keypair.generate();
    user = await createFundedUser(provider);
    mintAuthority = await createFundedUser(provider);

    mint1 = await createTokenMint(provider.connection, mintAuthority);
    mint2 = await createTokenMint(provider.connection, mintAuthority);
  });

  it("Is initialized!", async () => {
    const [dexManagerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("dex_manager")],
      program.programId
    );

    try {
      await program.methods.closeDexManager()
        .accountsPartial({
          dexManager: dexManagerPda,
          user: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
    } catch (error) {
      console.log("No existing dex_manager to close:", error.message);
    }

    await program.methods.initialize()
      .accountsPartial({
        dexManager: dexManagerPda,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
  });

  it("Should register token pair", async () => {
    const [tokenPairPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_pair"), mint1.toBuffer(), mint2.toBuffer()],
      program.programId
    );

    const [oppositePairPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_pair"), mint2.toBuffer(), mint1.toBuffer()],
      program.programId
    );

    await program.methods
      .registerTokenPair(mint1, mint2)
      .accountsPartial({
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
        tokenPair: tokenPairPda,
        oppositePair: oppositePairPda,
      })
      .signers([user])
      .rpc();

    const tokenPairAccount = await program.account.tokenPairAccount.fetch(tokenPairPda);
    expect(tokenPairAccount.buyToken.toString()).to.equal(mint1.toString());
    expect(tokenPairAccount.sellToken.toString()).to.equal(mint2.toString());
  });
});