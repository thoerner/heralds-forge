import {
  createPublicClient,
  http,
  keccak256,
  encodePacked,
  encodeFunctionData,
  decodeFunctionResult,
  toHex,
  pad,
  concat,
  parseAbi,
} from "viem";
import { mainnet } from "viem/chains";
import { config } from "dotenv";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { randomBytes, createHash } from "crypto";

config();

const HERALDIA = process.env.TOKEN_CONTRACT_ADDRESS;
const RENDERER = process.env.RENDERER_CONTRACT_ADDRESS;
const ART_SELECTION = process.env.ART_SELECTION_CONTRACT_ADDRESS;
const STORAGE = process.env.STORAGE_CONTRACT_ADDRESS;
const RPC_URL = process.env.RPC_URL || "https://ethereum-rpc.publicnode.com";

const heraldiaAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalSupply() view returns (uint256)",
]);

const rendererAbi = parseAbi([
  "function tokenURI(uint256 tokenId) view returns (string)",
]);

const artSelectionAbi = parseAbi([
  "function getActiveHash(uint256 tokenId) view returns (bool isActive, bytes32 customHash)",
]);

const storageAbi = parseAbi([
  "function getStaticHash(uint256 tokenId) view returns (bytes32)",
  "function getTransferCount(uint256 tokenId) view returns (uint256)",
]);

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});

// ---------------------------------------------------------------------------
// Storage slot helpers for ArtSelection state overrides
// ---------------------------------------------------------------------------

const ART_SELECTION_MAPPING_SLOT = 2n;

function artSelectionSlots(tokenId) {
  const baseSlot = keccak256(
    concat([
      pad(toHex(BigInt(tokenId)), { size: 32 }),
      pad(toHex(ART_SELECTION_MAPPING_SLOT), { size: 32 }),
    ])
  );
  const nextSlot = toHex(BigInt(baseSlot) + 1n, { size: 32 });
  return { hashSlot: baseSlot, selectedBySlot: nextSlot };
}

function packSelectedBy(address, isActive) {
  const addrBig = BigInt(address);
  const activeBit = isActive ? 1n << 160n : 0n;
  return toHex(addrBig | activeBit, { size: 32 });
}

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

async function fetchTokenURI(tokenId) {
  const uri = await client.readContract({
    address: RENDERER,
    abi: rendererAbi,
    functionName: "tokenURI",
    args: [BigInt(tokenId)],
  });
  return uri;
}

async function fetchTokenURIWithHash(tokenId, customHash) {
  const owner = await client.readContract({
    address: HERALDIA,
    abi: heraldiaAbi,
    functionName: "ownerOf",
    args: [BigInt(tokenId)],
  });

  const { hashSlot, selectedBySlot } = artSelectionSlots(tokenId);
  const packedOwner = packSelectedBy(owner, true);

  const data = encodeFunctionData({
    abi: rendererAbi,
    functionName: "tokenURI",
    args: [BigInt(tokenId)],
  });

  const result = await client.call({
    to: RENDERER,
    data,
    stateOverride: [
      {
        address: ART_SELECTION,
        stateDiff: [
          { slot: hashSlot, value: customHash },
          { slot: selectedBySlot, value: packedOwner },
        ],
      },
    ],
  });

  const decoded = decodeFunctionResult({
    abi: rendererAbi,
    functionName: "tokenURI",
    data: result.data,
  });

  return decoded;
}

// ---------------------------------------------------------------------------
// Decoding helpers
// ---------------------------------------------------------------------------

function decodeDataURI(dataUri) {
  const jsonB64 = dataUri.replace("data:application/json;base64,", "");
  const json = JSON.parse(Buffer.from(jsonB64, "base64").toString("utf-8"));
  return json;
}

function extractSVG(metadata) {
  const imageField = metadata.image;
  if (!imageField) return null;

  if (imageField.startsWith("data:image/svg+xml;base64,")) {
    const svgB64 = imageField.replace("data:image/svg+xml;base64,", "");
    return Buffer.from(svgB64, "base64").toString("utf-8");
  }

  if (imageField.startsWith("data:image/svg+xml,")) {
    return decodeURIComponent(
      imageField.replace("data:image/svg+xml,", "")
    );
  }

  return imageField;
}

function extractColors(svg) {
  if (!svg) return [];
  const matches = svg.matchAll(/#([0-9a-fA-F]{6})\b/g);
  return [...new Set([...matches].map((m) => "#" + m[1].toLowerCase()))].sort();
}

function computeDefaultHash(walletAddress, tokenId) {
  return keccak256(
    encodePacked(
      ["address", "uint256"],
      [walletAddress, BigInt(tokenId)]
    )
  );
}

async function fetchMetadataForProbe(tokenId, customHash, owner) {
  const { hashSlot, selectedBySlot } = artSelectionSlots(tokenId);
  const packedOwner = packSelectedBy(owner, true);
  const data = encodeFunctionData({
    abi: rendererAbi,
    functionName: "tokenURI",
    args: [BigInt(tokenId)],
  });
  const result = await client.call({
    to: RENDERER,
    data,
    stateOverride: [
      {
        address: ART_SELECTION,
        stateDiff: [
          { slot: hashSlot, value: customHash },
          { slot: selectedBySlot, value: packedOwner },
        ],
      },
    ],
  });
  const uri = decodeFunctionResult({
    abi: rendererAbi,
    functionName: "tokenURI",
    data: result.data,
  });
  const metadata = decodeDataURI(uri);
  const svg = extractSVG(metadata);
  const colors = extractColors(svg);
  const traits = {};
  if (metadata.attributes) {
    for (const attr of metadata.attributes) {
      traits[attr.trait_type] = attr.value;
    }
  }
  return { traits, colors };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function ensureOutputDir() {
  if (!existsSync("output")) mkdirSync("output");
}

function createPool(concurrency) {
  let active = 0;
  const queue = [];
  function next() {
    while (queue.length > 0 && active < concurrency) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn()
        .then(resolve, reject)
        .finally(() => {
          active--;
          next();
        });
    }
  }
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

function makeProbeHash(bytePos, byteVal) {
  const buf = Buffer.alloc(32, 0);
  buf[bytePos] = byteVal;
  return toHex(buf);
}

function saveArtwork(tokenId, suffix, metadata, svg) {
  ensureOutputDir();
  const base = `output/heraldia-${tokenId}${suffix ? "-" + suffix : ""}`;

  writeFileSync(`${base}.json`, JSON.stringify(metadata, null, 2));
  console.log(`  Metadata → ${base}.json`);

  if (svg) {
    writeFileSync(`${base}.svg`, svg);
    console.log(`  SVG      → ${base}.svg`);
  }
}

function printTraits(metadata) {
  if (!metadata.attributes) return;
  console.log("\n  Traits:");
  for (const attr of metadata.attributes) {
    console.log(`    ${attr.trait_type}: ${attr.value}`);
  }
}

// ---------------------------------------------------------------------------
// Extra info
// ---------------------------------------------------------------------------

async function printTokenInfo(tokenId) {
  try {
    const [owner, staticHash, transferCount, activeHash] = await Promise.all([
      client.readContract({
        address: HERALDIA,
        abi: heraldiaAbi,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
      }),
      client.readContract({
        address: STORAGE,
        abi: storageAbi,
        functionName: "getStaticHash",
        args: [BigInt(tokenId)],
      }),
      client.readContract({
        address: STORAGE,
        abi: storageAbi,
        functionName: "getTransferCount",
        args: [BigInt(tokenId)],
      }),
      client.readContract({
        address: ART_SELECTION,
        abi: artSelectionAbi,
        functionName: "getActiveHash",
        args: [BigInt(tokenId)],
      }),
    ]);

    console.log(`\n  Token #${tokenId}`);
    console.log(`  Owner:          ${owner}`);
    console.log(`  Static Hash:    ${staticHash}`);
    console.log(`  Transfer Count: ${transferCount}`);
    console.log(
      `  Custom Art:     ${activeHash[0] ? activeHash[1] : "none"}`
    );
    console.log(
      `  Default Hash:   ${computeDefaultHash(owner, tokenId)}`
    );
  } catch (e) {
    console.error(`  Could not fetch info for token #${tokenId}: ${e.shortMessage || e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdFetch(tokenId) {
  console.log(`\nFetching on-chain artwork for token #${tokenId}...`);
  await printTokenInfo(tokenId);

  const uri = await fetchTokenURI(tokenId);
  const metadata = decodeDataURI(uri);
  const svg = extractSVG(metadata);

  printTraits(metadata);
  saveArtwork(tokenId, "onchain", metadata, svg);
  console.log("\nDone.\n");
}

async function cmdPreview(tokenId, hash, label) {
  console.log(`\nPreviewing token #${tokenId} with hash ${hash}`);
  console.log(`  (${label})`);
  await printTokenInfo(tokenId);

  const uri = await fetchTokenURIWithHash(tokenId, hash);
  const metadata = decodeDataURI(uri);
  const svg = extractSVG(metadata);

  printTraits(metadata);

  const shortHash = hash.slice(0, 10);
  saveArtwork(tokenId, shortHash, metadata, svg);
  console.log("\nDone.\n");
}

async function cmdRandom(tokenId) {
  const hash = toHex(randomBytes(32));
  await cmdPreview(tokenId, hash, `random hash: ${hash}`);
}

async function cmdWallet(tokenId, wallet) {
  const hash = computeDefaultHash(wallet, tokenId);
  await cmdPreview(
    tokenId,
    hash,
    `simulating wallet ${wallet} owning token #${tokenId}`
  );
}

// ---------------------------------------------------------------------------
// Probe: systematic hash→trait mapping
// ---------------------------------------------------------------------------

async function cmdProbe(tokenId, options = {}) {
  const concurrency = options.concurrency || 5;
  const pool = createPool(concurrency);

  console.log(`\nProbing hash→trait mapping for token #${tokenId}...`);

  const owner = await client.readContract({
    address: HERALDIA,
    abi: heraldiaAbi,
    functionName: "ownerOf",
    args: [BigInt(tokenId)],
  });
  console.log(`  Owner: ${owner}`);
  ensureOutputDir();

  // Phase 1: Discovery — all 32 bytes, 16 samples each (step 16)
  const step = 16;
  const discoveryTasks = [];
  for (let bytePos = 0; bytePos < 32; bytePos++) {
    for (let val = 0; val < 256; val += step) {
      discoveryTasks.push({ bytePos, byteVal: val });
    }
  }

  console.log(
    `\n  Phase 1: Discovery (${discoveryTasks.length} calls, concurrency ${concurrency})...`
  );
  let completed = 0;
  const discoveryResults = await Promise.allSettled(
    discoveryTasks.map(({ bytePos, byteVal }) =>
      pool(async () => {
        const hash = makeProbeHash(bytePos, byteVal);
        const data = await fetchMetadataForProbe(tokenId, hash, owner);
        completed++;
        if (completed % 25 === 0 || completed === discoveryTasks.length) {
          process.stdout.write(
            `\r    ${completed}/${discoveryTasks.length} completed`
          );
        }
        return { bytePosition: bytePos, byteValue: byteVal, hash, ...data };
      })
    )
  );
  console.log();

  const discoveryOk = discoveryResults
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
  const discoveryFailed = discoveryResults.filter(
    (r) => r.status === "rejected"
  );
  if (discoveryFailed.length > 0) {
    console.log(`    ${discoveryFailed.length} calls failed`);
  }

  // Identify active bytes (where traits or colors varied)
  const activeBytes = new Set();
  for (let bytePos = 0; bytePos < 32; bytePos++) {
    const byteResults = discoveryOk.filter(
      (r) => r.bytePosition === bytePos
    );
    if (byteResults.length < 2) continue;
    const signatures = byteResults.map(
      (r) => JSON.stringify(r.traits) + "|" + r.colors.join(",")
    );
    if (new Set(signatures).size > 1) activeBytes.add(bytePos);
  }

  console.log(`  Active bytes: [${[...activeBytes].join(", ")}]`);

  const results = [...discoveryOk];

  // Phase 2: Fill active bytes with all 256 values
  if (activeBytes.size > 0) {
    const tested = new Set(
      discoveryOk.map((r) => `${r.bytePosition}:${r.byteValue}`)
    );
    const fillTasks = [];
    for (const bytePos of activeBytes) {
      for (let val = 0; val < 256; val++) {
        if (!tested.has(`${bytePos}:${val}`)) {
          fillTasks.push({ bytePos, byteVal: val });
        }
      }
    }

    console.log(
      `\n  Phase 2: Fill (${fillTasks.length} calls for bytes [${[...activeBytes].join(", ")}])...`
    );
    completed = 0;
    const fillResults = await Promise.allSettled(
      fillTasks.map(({ bytePos, byteVal }) =>
        pool(async () => {
          const hash = makeProbeHash(bytePos, byteVal);
          const data = await fetchMetadataForProbe(tokenId, hash, owner);
          completed++;
          if (completed % 50 === 0 || completed === fillTasks.length) {
            process.stdout.write(
              `\r    ${completed}/${fillTasks.length} completed`
            );
          }
          return { bytePosition: bytePos, byteValue: byteVal, hash, ...data };
        })
      )
    );
    console.log();

    const fillOk = fillResults
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);
    const fillFailed = fillResults.filter((r) => r.status === "rejected");
    if (fillFailed.length > 0) {
      console.log(`    ${fillFailed.length} calls failed`);
    }
    results.push(...fillOk);
  }

  results.sort(
    (a, b) => a.bytePosition - b.bytePosition || a.byteValue - b.byteValue
  );
  const outPath = "output/probe-results.json";
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n  Saved ${results.length} samples → ${outPath}`);
  console.log("Done.\n");
}

// ---------------------------------------------------------------------------
// Analyze: derive byte→trait operations from probe data
// ---------------------------------------------------------------------------

function findOperation(valueToTrait) {
  const uniqueTraits = [...new Set(valueToTrait.values())];
  const numCategories = uniqueTraits.length;

  // Try modulo (smallest consistent modulus)
  for (let mod = numCategories; mod <= 256; mod++) {
    const modToTrait = new Map();
    let consistent = true;
    for (const [byteVal, traitVal] of valueToTrait) {
      const modResult = byteVal % mod;
      if (modToTrait.has(modResult)) {
        if (modToTrait.get(modResult) !== traitVal) {
          consistent = false;
          break;
        }
      } else {
        modToTrait.set(modResult, traitVal);
      }
    }
    if (consistent) {
      const mapping = {};
      for (const [k, v] of modToTrait) mapping[k] = v;
      return { type: "mod", modulus: mod, mapping };
    }
  }

  // Try shift+mask
  for (let bits = 1; bits <= 8; bits++) {
    const mask = (1 << bits) - 1;
    for (let shift = 0; shift <= 8 - bits; shift++) {
      const maskToTrait = new Map();
      let consistent = true;
      for (const [byteVal, traitVal] of valueToTrait) {
        const masked = (byteVal >> shift) & mask;
        if (maskToTrait.has(masked)) {
          if (maskToTrait.get(masked) !== traitVal) {
            consistent = false;
            break;
          }
        } else {
          maskToTrait.set(masked, traitVal);
        }
      }
      if (consistent) {
        const mapping = {};
        for (const [k, v] of maskToTrait) mapping[k] = v;
        return { type: "mask", mask, shift, bits, mapping };
      }
    }
  }

  // Fallback: raw lookup
  const mapping = {};
  for (const [k, v] of valueToTrait) mapping[k] = v;
  return { type: "lookup", mapping };
}

async function cmdAnalyze() {
  const resultsPath = "output/probe-results.json";
  if (!existsSync(resultsPath)) {
    console.error(`Error: ${resultsPath} not found. Run 'probe' first.`);
    process.exit(1);
  }

  const results = JSON.parse(readFileSync(resultsPath, "utf-8"));
  console.log(`\nAnalyzing ${results.length} probe samples...\n`);

  const allTraitTypes = new Set();
  for (const r of results) {
    for (const key of Object.keys(r.traits)) allTraitTypes.add(key);
  }

  const traitMap = {};

  for (const traitType of allTraitTypes) {
    for (let bytePos = 0; bytePos < 32; bytePos++) {
      const byteResults = results.filter((r) => r.bytePosition === bytePos);
      if (byteResults.length < 2) continue;

      const valueToTrait = new Map();
      for (const r of byteResults) {
        if (r.traits[traitType] !== undefined) {
          valueToTrait.set(r.byteValue, r.traits[traitType]);
        }
      }

      const uniqueTraits = [...new Set(valueToTrait.values())];
      if (uniqueTraits.length <= 1) continue;

      const op = findOperation(valueToTrait);
      traitMap[traitType] = { byte: bytePos, ...op, values: uniqueTraits };

      const opDesc =
        op.type === "mod"
          ? `mod ${op.modulus}`
          : op.type === "mask"
            ? `mask 0x${op.mask.toString(16)} >> ${op.shift}`
            : `lookup (${Object.keys(op.mapping).length} entries)`;
      console.log(
        `  ${traitType}: byte ${bytePos}, ${opDesc} → ${uniqueTraits.length} values [${uniqueTraits.join(", ")}]`
      );
    }
  }

  // Color palette catalog (deduplicated across all samples)
  const allPalettes = new Map();
  for (const r of results) {
    const key = r.colors.join(",");
    if (!allPalettes.has(key)) allPalettes.set(key, { colors: r.colors, count: 0 });
    allPalettes.get(key).count++;
  }
  const paletteList = [...allPalettes.values()].sort((a, b) => b.count - a.count);
  console.log(`\n  Color palettes: ${paletteList.length} distinct (all bytes influence colors)`);
  console.log("    Top 10 most common:");
  for (const p of paletteList.slice(0, 10)) {
    console.log(`      ${p.colors.join("  ")}  (×${p.count})`);
  }
  traitMap._palettes = {
    total: paletteList.length,
    note: "All 32 hash bytes influence the color palette. Use --seed with craft to explore colors.",
    catalog: paletteList.map((p) => p.colors),
  };

  // Static traits
  console.log("\n  Static traits (not controlled by active hash):");
  for (const traitType of allTraitTypes) {
    if (!traitMap[traitType]) {
      const values = new Set(
        results.map((r) => r.traits[traitType]).filter(Boolean)
      );
      if (values.size === 1) {
        console.log(`    ${traitType}: ${[...values][0]}`);
      }
    }
  }

  const outPath = "output/trait-map.json";
  writeFileSync(outPath, JSON.stringify(traitMap, null, 2));
  console.log(`\n  Trait map saved → ${outPath}`);
  console.log("Done.\n");
}

// ---------------------------------------------------------------------------
// Craft: construct a hash from desired traits
// ---------------------------------------------------------------------------

async function cmdCraft(tokenId, desiredTraits, options = {}) {
  const mapPath = "output/trait-map.json";
  if (!existsSync(mapPath)) {
    console.error(`Error: ${mapPath} not found. Run 'analyze' first.`);
    process.exit(1);
  }

  const traitMap = JSON.parse(readFileSync(mapPath, "utf-8"));
  console.log(`\nCrafting hash for token #${tokenId}...`);
  if (options.seed !== undefined) {
    console.log(`  Using seed: ${options.seed}`);
  }

  const hashBytes = Buffer.alloc(32, 0);
  const byteConstraints = {};

  for (const [traitType, desiredValue] of Object.entries(desiredTraits)) {
    const info = traitMap[traitType];
    if (!info) {
      console.log(
        `  Warning: '${traitType}' not in trait map (static or unknown), skipping`
      );
      continue;
    }
    if (info.type === "palette") {
      console.log(`  Warning: '${traitType}' is a palette entry, skipping`);
      continue;
    }
    if (!byteConstraints[info.byte]) byteConstraints[info.byte] = [];
    byteConstraints[info.byte].push({ traitType, desiredValue, info });
  }

  for (const [bytePos, constraints] of Object.entries(byteConstraints)) {
    const pos = Number(bytePos);

    if (constraints.length === 1) {
      const { traitType, desiredValue, info } = constraints[0];
      const reverseMap = {};
      for (const [key, val] of Object.entries(info.mapping)) {
        reverseMap[val] = Number(key);
      }
      if (reverseMap[desiredValue] === undefined) {
        console.error(
          `  Error: '${desiredValue}' is not a valid value for ${traitType}`
        );
        console.error(`    Valid values: ${info.values.join(", ")}`);
        process.exit(1);
      }
      const target = reverseMap[desiredValue];
      if (info.type === "mod") {
        hashBytes[pos] = target;
      } else if (info.type === "mask") {
        hashBytes[pos] = target << (info.shift || 0);
      } else {
        hashBytes[pos] = target;
      }
      console.log(
        `  Byte ${pos} = 0x${hashBytes[pos].toString(16).padStart(2, "0")} → ${traitType}: ${desiredValue}`
      );
    } else {
      // Multiple traits share a byte — brute-force to find a satisfying value
      let found = false;
      for (let val = 0; val < 256; val++) {
        let allMatch = true;
        for (const { desiredValue, info } of constraints) {
          let result;
          if (info.type === "mod") {
            result = info.mapping[val % info.modulus];
          } else if (info.type === "mask") {
            result = info.mapping[(val >> (info.shift || 0)) & info.mask];
          } else {
            result = info.mapping[val];
          }
          if (result !== desiredValue) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          hashBytes[pos] = val;
          found = true;
          const summary = constraints
            .map((c) => `${c.traitType}: ${c.desiredValue}`)
            .join(", ");
          console.log(
            `  Byte ${pos} = 0x${val.toString(16).padStart(2, "0")} → ${summary}`
          );
          break;
        }
      }
      if (!found) {
        console.error(
          `  Error: no single byte value satisfies all constraints on byte ${pos}:`
        );
        for (const c of constraints) {
          console.error(`    ${c.traitType} = ${c.desiredValue}`);
        }
        process.exit(1);
      }
    }
  }

  // Fill unused bytes (deterministic if seed provided, random otherwise)
  const usedBytes = new Set(Object.keys(byteConstraints).map(Number));
  const filler =
    options.seed !== undefined
      ? createHash("sha256").update(String(options.seed)).digest()
      : randomBytes(32);
  for (let i = 0; i < 32; i++) {
    if (!usedBytes.has(i)) {
      hashBytes[i] = filler[i];
    }
  }

  const hash = toHex(hashBytes);
  console.log(`\n  Crafted hash: ${hash}`);

  await cmdPreview(
    tokenId,
    hash,
    `crafted: ${Object.entries(desiredTraits)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.log(`
Heraldia Art Generator — local artwork pipeline

Usage:
  node generate.mjs fetch    <tokenId>                   Fetch real on-chain artwork
  node generate.mjs preview  <tokenId> --hash <bytes32>  Preview with a specific hash
  node generate.mjs preview  <tokenId> --wallet <addr>   Preview as if wallet owned it
  node generate.mjs preview  <tokenId> --random          Preview with a random hash
  node generate.mjs probe    <tokenId> [--concurrency N] Probe hash→trait mapping
  node generate.mjs analyze                              Analyze probe results → trait map
  node generate.mjs craft    <tokenId> [--seed N] --<Trait> <value>  Craft hash for desired traits

Examples:
  node generate.mjs fetch 1
  node generate.mjs preview 1 --random
  node generate.mjs probe 1702
  node generate.mjs analyze
  node generate.mjs craft 1702 --Background "Grid Bold" --Pattern "Cross"
  node generate.mjs craft 1702 --seed 42 --Background "Grid Bold" --Pattern "Cross"

Output is saved to the output/ directory.
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    usage();
    process.exit(0);
  }

  const command = args[0];

  if (command === "fetch") {
    const tokenId = args[1];
    if (!tokenId) {
      console.error("Error: token ID required. Usage: node generate.mjs fetch <tokenId>");
      process.exit(1);
    }
    await cmdFetch(tokenId);
    return;
  }

  if (command === "preview") {
    const tokenId = args[1];
    if (!tokenId) {
      console.error("Error: token ID required.");
      process.exit(1);
    }

    const flagIdx = args.indexOf("--hash");
    const walletIdx = args.indexOf("--wallet");
    const randomIdx = args.indexOf("--random");

    if (flagIdx !== -1) {
      const hash = args[flagIdx + 1];
      if (!hash || !hash.startsWith("0x") || hash.length !== 66) {
        console.error("Error: --hash requires a 66-char hex bytes32 value (0x + 64 hex chars).");
        process.exit(1);
      }
      await cmdPreview(tokenId, hash, `custom hash: ${hash}`);
    } else if (walletIdx !== -1) {
      const wallet = args[walletIdx + 1];
      if (!wallet || !wallet.startsWith("0x") || wallet.length !== 42) {
        console.error("Error: --wallet requires a valid Ethereum address.");
        process.exit(1);
      }
      await cmdWallet(tokenId, wallet);
    } else if (randomIdx !== -1) {
      await cmdRandom(tokenId);
    } else {
      console.error("Error: preview requires --hash, --wallet, or --random.");
      process.exit(1);
    }
    return;
  }

  if (command === "probe") {
    const tokenId = args[1];
    if (!tokenId) {
      console.error(
        "Error: token ID required. Usage: node generate.mjs probe <tokenId>"
      );
      process.exit(1);
    }
    const concIdx = args.indexOf("--concurrency");
    const concurrency = concIdx !== -1 ? Number(args[concIdx + 1]) : 5;
    await cmdProbe(tokenId, { concurrency });
    return;
  }

  if (command === "analyze") {
    await cmdAnalyze();
    return;
  }

  if (command === "craft") {
    const tokenId = args[1];
    if (!tokenId) {
      console.error(
        "Error: token ID required. Usage: node generate.mjs craft <tokenId> --<Trait> <value>"
      );
      process.exit(1);
    }
    const desiredTraits = {};
    let seed;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--seed") {
        seed = Number(args[++i]);
        continue;
      }
      if (args[i].startsWith("--")) {
        const key = args[i].slice(2);
        const val = args[i + 1];
        if (val) {
          desiredTraits[key] = val;
          i++;
        }
      }
    }
    if (Object.keys(desiredTraits).length === 0) {
      console.error("Error: no traits specified. Use --<TraitName> <value>");
      process.exit(1);
    }
    await cmdCraft(tokenId, desiredTraits, { seed });
    return;
  }

  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error("\nError:", err.shortMessage || err.message);
  if (err.details) console.error("Details:", err.details);
  process.exit(1);
});
