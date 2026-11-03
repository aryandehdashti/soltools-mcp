/**
 * Demo setup: creates a funded client wallet + a devnet test token to run the
 * full x402 paid flow end-to-end without needing the Circle faucet.
 *
 * Outputs: .demo/client-keypair.json, .demo/mint.json
 */
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, mintTo, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";

config();

const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const outDir = path.join(process.cwd(), ".demo");
fs.mkdirSync(outDir, { recursive: true });

const client = Keypair.generate();
fs.writeFileSync(path.join(outDir, "client-keypair.json"), JSON.stringify(Array.from(client.secretKey)));
console.log("client:", client.publicKey.toBase58());

const sig = await connection.requestAirdrop(client.publicKey, 0.5 * LAMPORTS_PER_SOL);
await connection.confirmTransaction(sig, "confirmed");
console.log("airdropped 0.5 SOL");

const mint = await createMint(connection, client, client.publicKey, null, 6);
fs.writeFileSync(path.join(outDir, "mint.json"), JSON.stringify({ mint: mint.toBase58() }));
console.log("mint:", mint.toBase58());

const ata = await getOrCreateAssociatedTokenAccount(connection, client, mint, client.publicKey);
await mintTo(connection, client, mint, ata.address, client, 1000_000000);
console.log("minted 1000 tokens to client");

console.log("DONE. Set DEMO_MINT=" + mint.toBase58() + " and use .demo/client-keypair.json as the paying wallet.");
