import { sha256, toHex } from "viem";
import { TRAIT_MAP, type TraitName } from "./contracts";

export interface TraitSelection {
  Theme: number;
  Pattern: number;
  Background: number;
}

export function craftHash(
  traits: TraitSelection,
  seed: number,
): `0x${string}` {
  const bytes = new Uint8Array(32);

  // Set trait bytes
  bytes[TRAIT_MAP.Theme.byte] = traits.Theme;
  bytes[TRAIT_MAP.Pattern.byte] = traits.Pattern;
  bytes[TRAIT_MAP.Background.byte] = traits.Background;

  // Fill remaining bytes deterministically from seed
  const seedHash = sha256(toHex(BigInt(seed)));
  const seedBytes = hexToBytes(seedHash);
  const usedBytes = new Set<number>([
    TRAIT_MAP.Theme.byte,
    TRAIT_MAP.Pattern.byte,
    TRAIT_MAP.Background.byte,
  ]);
  for (let i = 0; i < 32; i++) {
    if (!usedBytes.has(i)) {
      bytes[i] = seedBytes[i];
    }
  }

  return bytesToHex(bytes);
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

export function traitLabel(trait: TraitName, index: number): string {
  return (
    TRAIT_MAP[trait].options.find((o) => o.index === index)?.label ?? "Unknown"
  );
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const clean = hex.slice(2);
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}
