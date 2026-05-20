import { useState, useRef, useCallback, useEffect } from "react";
import {
  keccak256,
  concat,
  pad,
  toHex,
  encodeFunctionData,
  decodeFunctionResult,
} from "viem";
import { usePublicClient } from "wagmi";
import {
  RENDERER_ADDRESS,
  ART_SELECTION_ADDRESS,
  TRAIT_MAP,
  rendererAbi,
} from "./contracts";
import type { TraitSelection } from "./hashCraft";
import { extractColorsFromSvg } from "./accentColors";

const ART_SELECTION_MAPPING_SLOT = 2n;

function artSelectionSlots(tokenId: bigint) {
  const baseSlot = keccak256(
    concat([
      pad(toHex(tokenId), { size: 32 }),
      pad(toHex(ART_SELECTION_MAPPING_SLOT), { size: 32 }),
    ]),
  );
  const nextSlot = toHex(BigInt(baseSlot) + 1n, { size: 32 });
  return {
    hashSlot: baseSlot as `0x${string}`,
    selectedBySlot: nextSlot as `0x${string}`,
  };
}

function packSelectedBy(address: `0x${string}`): `0x${string}` {
  return toHex(BigInt(address) | (1n << 160n), { size: 32 });
}

function buildSweepHash(
  traits: TraitSelection,
  bytePos: number,
  byteVal: number,
  baseRand: number,
): `0x${string}` {
  const bytes = new Uint8Array(32);
  const r = (baseRand * 2654435761) >>> 0;
  const usedBytes = new Set([
    TRAIT_MAP.Theme.byte,
    TRAIT_MAP.Pattern.byte,
    TRAIT_MAP.Background.byte,
    bytePos,
  ]);
  for (let i = 0; i < 32; i++) {
    if (!usedBytes.has(i)) {
      bytes[i] =
        ((r >>> (i % 24)) ^ (i * 37) ^ (baseRand >>> (i % 16))) & 0xff;
    }
  }
  bytes[TRAIT_MAP.Theme.byte] = traits.Theme;
  bytes[TRAIT_MAP.Pattern.byte] = traits.Pattern;
  bytes[TRAIT_MAP.Background.byte] = traits.Background;
  bytes[bytePos] = byteVal;
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

const SWEEP_BYTES = [3, 4, 5, 6, 7];
const CONCURRENCY = 10;

export function useColorSweep(
  tokenId: bigint,
  ownerAddress: `0x${string}`,
  traits: TraitSelection,
) {
  const publicClient = usePublicClient();
  const [available, setAvailable] = useState<Set<string>>(new Set());
  const [colorToHash, setColorToHash] = useState<Map<string, `0x${string}`>>(
    new Map(),
  );
  const [sweeping, setSweeping] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hasRun, setHasRun] = useState(false);
  const abortRef = useRef(0);

  // Clear results when traits change
  useEffect(() => {
    abortRef.current++;
    setSweeping(false);
    setAvailable(new Set());
    setColorToHash(new Map());
    setProgress(0);
    setHasRun(false);
  }, [traits.Theme, traits.Pattern, traits.Background]);

  const startSweep = useCallback(() => {
    if (!publicClient || sweeping) return;

    const runId = ++abortRef.current;
    const total = SWEEP_BYTES.length * 256;
    let done = 0;
    const found = new Map<string, `0x${string}`>();

    setSweeping(true);
    setProgress(0);
    setAvailable(new Set());
    setColorToHash(new Map());
    setHasRun(true);

    const { hashSlot, selectedBySlot } = artSelectionSlots(tokenId);
    const packedOwner = packSelectedBy(ownerAddress);
    const callData = encodeFunctionData({
      abi: rendererAbi,
      functionName: "tokenURI",
      args: [tokenId],
    });

    const baseRand = Date.now();
    const currentTraits = { ...traits };

    async function probeHash(hash: `0x${string}`) {
      const result = await publicClient!.call({
        to: RENDERER_ADDRESS,
        data: callData,
        stateOverride: [
          {
            address: ART_SELECTION_ADDRESS,
            stateDiff: [
              { slot: hashSlot, value: hash },
              { slot: selectedBySlot, value: packedOwner },
            ],
          },
        ],
      });
      const uri = decodeFunctionResult({
        abi: rendererAbi,
        functionName: "tokenURI",
        data: result.data!,
      });
      const jsonB64 = (uri as string).replace(
        "data:application/json;base64,",
        "",
      );
      const metadata = JSON.parse(atob(jsonB64));
      const img = metadata.image as string;
      let svg = "";
      if (img?.startsWith("data:image/svg+xml;base64,")) {
        svg = atob(img.replace("data:image/svg+xml;base64,", ""));
      } else if (img?.startsWith("data:image/svg+xml,")) {
        svg = decodeURIComponent(img.replace("data:image/svg+xml,", ""));
      }
      return extractColorsFromSvg(svg);
    }

    (async () => {
      for (const bytePos of SWEEP_BYTES) {
        for (let start = 0; start < 256; start += CONCURRENCY) {
          if (abortRef.current !== runId) return;

          const batchSize = Math.min(CONCURRENCY, 256 - start);
          const promises = Array.from({ length: batchSize }, (_, i) => {
            const hash = buildSweepHash(
              currentTraits,
              bytePos,
              start + i,
              baseRand,
            );
            return probeHash(hash)
              .then((colors) => {
                for (const c of colors) {
                  if (c !== "#000000" && c !== "#ffffff" && !found.has(c)) {
                    found.set(c, hash);
                  }
                }
              })
              .catch(() => {});
          });

          await Promise.all(promises);
          done += batchSize;

          if (abortRef.current !== runId) return;
          setProgress(done / total);
          setAvailable(new Set(found.keys()));
          setColorToHash(new Map(found));
        }
      }

      if (abortRef.current === runId) {
        setSweeping(false);
        setProgress(1);
      }
    })();
  }, [publicClient, tokenId, ownerAddress, traits, sweeping]);

  return { available, colorToHash, sweeping, progress, hasRun, startSweep };
}
