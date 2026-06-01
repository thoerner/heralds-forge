import { useState, useCallback, useRef } from "react";
import {
  toHex,
  encodeFunctionData,
  decodeFunctionResult,
  sha256,
} from "viem";
import { usePublicClient } from "wagmi";
import {
  RENDERER_ADDRESS,
  TRAIT_MAP,
  rendererAbi,
  type TraitName,
} from "./contracts";
import { buildPreviewStateOverride } from "./stateOverride";
import type { TraitSelection } from "./hashCraft";
import { extractColorsFromSvg } from "./accentColors";

function buildRandomHash(traits: TraitSelection, attempt: number): `0x${string}` {
  const bytes = new Uint8Array(32);
  bytes[TRAIT_MAP.Theme.byte] = traits.Theme;
  bytes[TRAIT_MAP.Pattern.byte] = traits.Pattern;
  bytes[TRAIT_MAP.Background.byte] = traits.Background;

  const seedHex = sha256(toHex(BigInt(Date.now() * 1000 + attempt)));
  const seedClean = seedHex.slice(2);
  const usedBytes = new Set<number>([
    TRAIT_MAP.Theme.byte,
    TRAIT_MAP.Pattern.byte,
    TRAIT_MAP.Background.byte,
  ]);
  for (let i = 0; i < 32; i++) {
    if (!usedBytes.has(i)) {
      bytes[i] = parseInt(seedClean.slice(i * 2, i * 2 + 2), 16);
    }
  }

  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export interface ColorSearchResult {
  hash: `0x${string}`;
  svg: string;
  colors: string[];
}

export function useColorSearch() {
  const publicClient = usePublicClient();
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState({ tested: 0, found: 0 });
  const [results, setResults] = useState<ColorSearchResult[]>([]);
  const abortRef = useRef(false);

  const search = useCallback(
    async (
      tokenId: bigint,
      ownerAddress: `0x${string}`,
      targetColor: string,
      traits: TraitSelection,
      maxAttempts = 300,
    ) => {
      if (!publicClient) return;
      abortRef.current = false;
      setSearching(true);
      setProgress({ tested: 0, found: 0 });
      setResults([]);

      const target = targetColor.toLowerCase();
      const data = encodeFunctionData({
        abi: rendererAbi,
        functionName: "tokenURI",
        args: [tokenId],
      });

      let tested = 0;
      const found: ColorSearchResult[] = [];
      const CONCURRENCY = 5;
      const MAX_RESULTS = 8;

      for (let batch = 0; batch < maxAttempts; batch += CONCURRENCY) {
        if (abortRef.current || found.length >= MAX_RESULTS) break;

        const batchSize = Math.min(CONCURRENCY, maxAttempts - batch);
        const promises = Array.from({ length: batchSize }, (_, i) => {
          const hash = buildRandomHash(traits, batch + i);
          return publicClient
            .call({
              to: RENDERER_ADDRESS,
              data,
              stateOverride: buildPreviewStateOverride(tokenId, hash, ownerAddress),
            })
            .then((result) => {
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
              const colors = extractColorsFromSvg(svg);
              return { hash, svg, colors };
            })
            .catch(() => null);
        });

        const results = await Promise.all(promises);
        if (abortRef.current) break;

        for (const r of results) {
          if (!r) continue;
          tested++;
          if (r.colors.includes(target)) {
            found.push(r);
          }
        }

        setProgress({ tested, found: found.length });
        setResults([...found]);
      }

      setSearching(false);
    },
    [publicClient],
  );

  const cancel = useCallback(() => {
    abortRef.current = true;
  }, []);

  return { search, cancel, searching, progress, results };
}
