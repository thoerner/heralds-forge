import { useState, useEffect, useCallback, useRef } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { QRCodeSVG } from "qrcode.react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import {
  HERALDIA_ADDRESS,
  RENDERER_ADDRESS,
  ART_SELECTION_ADDRESS,
  ART_SELECTION_V2_ADDRESS,
  STORAGE_ADDRESS,
  heraldiaAbi,
  rendererAbi,
  artSelectionAbi,
  artSelectionV2Abi,
  storageAbi,
  TRAIT_MAP,
  type TraitName,
} from "./contracts";
import { craftHash, randomSeed, type TraitSelection } from "./hashCraft";
import { usePreview } from "./usePreview";
import { usePastLooks } from "./usePastLooks";
import { useColorSearch } from "./useColorSearch";
import { useColorSweep } from "./useColorSweep";
import { ACCENT_COLORS } from "./accentColors";
import { generateWalletPattern } from "./walletPattern";
import { track } from "./track";

// ---------------------------------------------------------------------------
// Gallery token type
// ---------------------------------------------------------------------------

const DONATE_ADDRESS = "0xc05FFc2fa06DAC5BaF09072752Cc21Cc832f6341";

function refreshOpenSeaMetadata(tokenId: bigint) {
  const key = import.meta.env.VITE_OPENSEA_API_KEY as string;
  if (!key) return;
  fetch(
    `https://api.opensea.io/api/v2/chain/ethereum/contract/${HERALDIA_ADDRESS}/nfts/${tokenId}/refresh`,
    {
      method: "POST",
      headers: { "x-api-key": key },
    },
  ).catch(() => {});
}

// ---------------------------------------------------------------------------
// Theme toggle
// ---------------------------------------------------------------------------

type Theme = "dark" | "light";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("hf-theme") as Theme) ?? "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("hf-theme", theme);
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  return [theme, toggle];
}

// ---------------------------------------------------------------------------
// Donation QR popover
// ---------------------------------------------------------------------------

function DonateWithQR() {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  function copy() {
    navigator.clipboard.writeText(DONATE_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  useEffect(() => {
    if (!show) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShow(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [show]);

  return (
    <div className="donate-row" ref={wrapRef}>
      <span>Donations welcome</span>
      <code
        className="donate-addr"
        onClick={copy}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        title="Click to copy"
      >
        {copied
          ? "Copied!"
          : `${DONATE_ADDRESS.slice(0, 6)}\u2026${DONATE_ADDRESS.slice(-4)}`}
      </code>
      {show && (
        <div className="qr-popover" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
          <QRCodeSVG
            value={`ethereum:${DONATE_ADDRESS}`}
            size={140}
            bgColor="transparent"
            fgColor="currentColor"
            level="M"
          />
          <span className="qr-label">{DONATE_ADDRESS.slice(0, 10)}&hellip;{DONATE_ADDRESS.slice(-6)}</span>
        </div>
      )}
    </div>
  );
}

function Copyable({ value, display }: { value: string; display: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <span className="copyable" onClick={handleCopy} title={`${value}\nClick to copy`}>
      {copied ? "Copied!" : display}
    </span>
  );
}

interface OwnedToken {
  tokenId: bigint;
  svg: string | null;
}

// ---------------------------------------------------------------------------
// Landing page (not connected)
// ---------------------------------------------------------------------------

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "Is this an exploit?",
    a: "Not in the \u201csteal funds / take assets\u201d sense. It uses owner permissions already available on-chain. Think \u201cunexpected capability + better tooling,\u201d not contract takeover.",
  },
  {
    q: "Can someone change my NFT without permission?",
    a: "No. Only the current token owner can set artwork for that token.",
  },
  {
    q: "Can you rug or lock tokens?",
    a: "No token custody in Forge. You sign transactions from your own wallet.",
  },
  {
    q: "Why didn\u2019t the core team build this?",
    a: "No idea \u2014 this is just an independent experiment from a holder/dev perspective.",
  },
  {
    q: "This breaks rarity.",
    a: "It changes how people think about rarity: from static traits to evolving provenance + design history.",
  },
  {
    q: "Not official = sketchy.",
    a: "Fair take. That\u2019s why it\u2019s clearly labeled unofficial, with on-chain transparency and owner-only writes.",
  },
  {
    q: "What about malicious inputs?",
    a: "Params are encoded and submitted on-chain via standard wallet signing. Still: always verify tx details before confirming.",
  },
  {
    q: "My art didn\u2019t update on OpenSea.",
    a: "We refresh your token\u2019s metadata on OpenSea automatically after each change, but OpenSea sometimes caches old metadata even after a refresh is triggered. This happens with all dynamic artwork collections \u2014 checking again later usually shows the correct art.",
  },
  {
    q: "Do you track or sell my data?",
    a: "We collect lightweight, self-hosted usage statistics to understand which features are used. We do not use cookies, fingerprinting, third-party analytics, wallet-address tracking, or persistent user identifiers.",
  },
  {
    q: "Is this permanent?",
    a: "No. When you transfer the token to someone else, the artwork will mutate according to the Heraldia protocol. However, token holders can re-apply any artwork created by the forge by browsing the token\u2019s Past Looks. You can also still use the official Time Machine as normal, or reset the custom artwork to your default artwork per the protocol.",
  },
  {
    q: "What\u2019s the donation button about? Does this cost you money?",
    a: "Herald\u2019s Forge is a free community tool and always will be. That said, it\u2019s not free to run \u2014 hosting, domain registration, and especially the color sweep feature (which hammers RPC endpoints pretty hard) all have real costs. If you enjoy the tool and want to help keep the lights on, a small tip is always appreciated but never expected.",
  },
];

function FAQPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="faq-page">
      <button className="back-btn" onClick={onBack}>
        <span aria-hidden="true">&larr;</span> Back
      </button>
      <div className="faq">
        <h2 className="faq-heading">Frequently Asked Questions</h2>
        <div className="faq-list">
          {FAQ_ITEMS.map((item) => (
            <details key={item.q} className="faq-item">
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

const CONTRACT_INFO = [
  {
    role: "NFT Token",
    name: "Heraldia (ERC-721)",
    address: HERALDIA_ADDRESS,
    desc: "The core NFT contract. Holds ownership, delegates rendering to the Renderer, and increments transfer counts on every transfer. Implements ERC-721, EIP-2981 royalties, and EIP-4906 metadata update signals.",
  },
  {
    role: "Renderer",
    name: "HeraldiaRendererV4",
    address: RENDERER_ADDRESS,
    desc: "The on-chain rendering engine. Computes JSON metadata and SVG artwork entirely on-chain by reading hash bytes and mapping them to visual traits. Checks ArtSelectionV2 first, then falls back to V1.",
  },
  {
    role: "Storage",
    name: "HeraldiaStorage",
    address: STORAGE_ADDRESS,
    desc: "Stores two immutable pieces of per-token data: the original static hash (set at mint) and the transfer count (incremented on every transfer). The static hash never changes.",
  },
  {
    role: "Art Selection (V1)",
    name: "HeraldiaArtSelection",
    address: ART_SELECTION_ADDRESS,
    desc: "The original art selection contract. Allows token owners to override artwork with a bytes32 hash. Custom art resets on the first transfer.",
  },
  {
    role: "Art Selection (V2)",
    name: "HeraldiaArtSelectionV2",
    address: ART_SELECTION_V2_ADDRESS,
    desc: "The upgraded art selection contract with Time Machine support. Custom art can survive up to 16 transfers, and owners can set an optional \u201cBack to the Future\u201d commemorative date.",
  },
];

function TechPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="faq-page">
      <button className="back-btn" onClick={onBack}>
        <span aria-hidden="true">&larr;</span> Back
      </button>
      <div className="tech-details">
        <h2 className="faq-heading">Technical Details</h2>

        <section className="tech-section">
          <h3>How It Works</h3>
          <p>
            Heraldia artwork is generated entirely on-chain. Every token has a <strong>hash</strong> &mdash; a 32-byte
            value &mdash; that the renderer reads byte-by-byte to determine visual traits like theme, pattern,
            background, emblem, and colors.
          </p>
          <p>
            By default, a token&rsquo;s hash is computed as <code>keccak256(owner, tokenId)</code>, meaning the
            artwork changes every time the token is transferred to a new wallet. The <strong>Art Selection</strong>{" "}
            contract lets owners override this with any custom hash, which is exactly what Herald&rsquo;s Forge does.
          </p>
        </section>

        <section className="tech-section">
          <h3>The Rendering Pipeline</h3>
          <ol className="tech-pipeline">
            <li>You call <code>tokenURI(tokenId)</code> on the Renderer</li>
            <li>It checks <strong>Art Selection</strong> for a custom hash override</li>
            <li>If none, it computes <code>keccak256(owner, tokenId)</code> as the default</li>
            <li>The active hash bytes are mapped to traits (theme, pattern, background, colors, etc.)</li>
            <li>The Renderer calls the <strong>Color Wrapper</strong> to generate the full SVG</li>
            <li>Everything is assembled into a JSON metadata object with a base64-encoded SVG</li>
          </ol>
        </section>

        <section className="tech-section">
          <h3>What Herald&rsquo;s Forge Does</h3>
          <p>
            When you pick a theme, pattern, and background in the Forge, we construct a <code>bytes32</code> hash
            where specific bytes are set to produce those exact traits. The remaining bytes control color and variation.
          </p>
          <p>
            We preview the result locally using Ethereum&rsquo;s <code>stateOverride</code> feature &mdash; simulating
            the on-chain call with your chosen hash without spending gas. When you&rsquo;re happy, we submit a{" "}
            <code>selectArt(tokenId, hash, artType, artData)</code> transaction via ArtSelectionV2 to write it on-chain.
            The <code>artType</code> parameter sets the Time Machine &mdash; how many transfers the custom art survives &mdash;
            and <code>artData</code> stores an optional commemorative timestamp.
          </p>
        </section>

        <section className="tech-section">
          <h3>Hash &rarr; Trait Mapping</h3>
          <table className="tech-table">
            <thead>
              <tr><th>Byte</th><th>Trait</th><th>How</th></tr>
            </thead>
            <tbody>
              <tr><td>0</td><td>Theme</td><td>Lower bits, mod 2 &rarr; Sun or Moon</td></tr>
              <tr><td>1</td><td>Pattern</td><td>Mod 4 &rarr; Pixel, Dot, Cross, or Mix</td></tr>
              <tr><td>2</td><td>Background</td><td>Mod 21 &rarr; one of 21 background styles</td></tr>
              <tr><td>3+</td><td>Colors &amp; Variation</td><td>Remaining bytes feed the color palette randomizer</td></tr>
              <tr><td>&mdash;</td><td>Transfers</td><td>Read from Storage contract, bucketed (0, 1-2, 3-4, &hellip;)</td></tr>
            </tbody>
          </table>
        </section>

        <section className="tech-section">
          <h3>Contracts</h3>
          <div className="tech-contracts">
            {CONTRACT_INFO.map((c) => (
              <div key={c.address} className="tech-contract-card">
                <div className="tech-contract-role">{c.role}</div>
                <div className="tech-contract-name">{c.name}</div>
                <a
                  className="tech-contract-address"
                  href={`https://etherscan.io/address/${c.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {c.address}
                </a>
                <p className="tech-contract-desc">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="tech-section">
          <h3>Dynamic Art &amp; Transfers</h3>
          <table className="tech-table">
            <thead>
              <tr><th>Scenario</th><th>What Happens</th></tr>
            </thead>
            <tbody>
              <tr><td>No custom art</td><td>Hash = <code>keccak256(owner, tokenId)</code> &mdash; art changes on every transfer</td></tr>
              <tr><td>Custom art via Forge</td><td>Your chosen hash is used &mdash; art stays fixed while you hold the token</td></tr>
              <tr><td>Token transferred</td><td>New owner sees their default art; your custom art is stored but inactive</td></tr>
              <tr><td>Token transferred back</td><td>Your custom art reactivates automatically*</td></tr>
              <tr><td>Reset art</td><td>Removes custom hash, reverts to dynamic behavior</td></tr>
            </tbody>
          </table>
          <p className="tech-footnote">
            *If another owner applies the same hash while holding the token, the contract&rsquo;s{" "}
            <code>selectedBy</code> field updates to their address. In that case, you&rsquo;ll need to re-apply
            it yourself from Past Looks.
          </p>
        </section>

        <section className="tech-section">
          <h3>Past Looks</h3>
          <p>
            Every <code>selectArt</code> call emits an <code>ArtSelected</code> event on-chain. The Forge reads
            these event logs to build a history of all hashes ever applied to a token &mdash; by any owner. Any
            current holder can re-apply a previous look with one click.
          </p>
        </section>
      </div>
    </div>
  );
}

interface RecentForge {
  tokenId: string;
  svg: string;
}

const CREST_POSITIONS = [
  { top: "6%", left: "4%" },
  { top: "14%", right: "6%" },
  { top: "30%", left: "2%" },
  { top: "42%", right: "3%" },
  { top: "22%", left: "9%" },
  { top: "58%", right: "8%" },
  { top: "70%", left: "5%" },
  { top: "78%", right: "5%" },
  { top: "50%", left: "7%" },
  { top: "88%", right: "7%" },
];

function useRecentForges(): RecentForge[] {
  const [forges, setForges] = useState<RecentForge[]>([]);

  useEffect(() => {
    fetch(import.meta.env.VITE_FORGE_API_URL as string)
      .then((r) => r.json())
      .then((data: RecentForge[]) => setForges(data.slice(0, 10)))
      .catch(() => {});
  }, []);

  return forges;
}

function Landing({ onFaq }: { onFaq: () => void }) {
  const recentForges = useRecentForges();

  useEffect(() => { track("page_view"); }, []);

  return (
    <div className="landing">
      {recentForges.length > 0 && (
        <div className="floating-crests" aria-hidden="true">
          {recentForges.map((forge, i) => {
            const pos = CREST_POSITIONS[i % CREST_POSITIONS.length];
            const delay = (parseInt(forge.tokenId, 10) % 7) * -3;
            const size = 60 + (parseInt(forge.tokenId, 10) % 40);
            return (
              <div
                key={forge.tokenId}
                className="floating-crest"
                style={{
                  ...pos,
                  width: size,
                  height: size,
                  animationDelay: `${delay}s`,
                }}
                dangerouslySetInnerHTML={{ __html: forge.svg }}
              />
            );
          })}
        </div>
      )}
      <div className="landing-hero">
        <p className="eyebrow">Unofficial community tool</p>
        <h2>Herald&rsquo;s Forge</h2>
        <p className="tagline">
          Craft a custom composition for your Heraldia tokens.
        </p>
        <p className="description">
          A small companion to{" "}
          <a
            href="https://heraldia.art"
            target="_blank"
            rel="noopener noreferrer"
          >
            heraldia.art
          </a>
          . Pick a theme, pattern, and background, preview the result, then
          write it on-chain with <code>selectArt</code>. Not affiliated with
          ab83 or the Heraldia team.
        </p>
        <div className="landing-cta">
          <ConnectButton showBalance={false} />
        </div>
        <div className="landing-links">
          <a
            href="https://heraldia.art"
            target="_blank"
            rel="noopener noreferrer"
          >
            heraldia.art
          </a>
          <span className="sep" />
          <a
            href="https://opensea.io/collection/heraldia"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenSea
          </a>
          <span className="sep" />
          <a
            href={`https://etherscan.io/address/${HERALDIA_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Etherscan
          </a>
          <span className="sep" />
          <button className="landing-link-btn" onClick={onFaq}>
            FAQ
          </button>
        </div>
        <a
          className="contract-cite"
          href="https://etherscan.io/address/0x3Af98Fb4dC151AF77C6bE0012Efa165033E88769#code#F1#L32"
          target="_blank"
          rel="noopener noreferrer"
          title="The on-chain function that makes this possible"
        >
          <span className="cite-kw">function</span>{" "}
          <span className="cite-fn">selectArt</span>
          <span className="cite-paren">(</span>
          <span className="cite-type">uint256</span>{" "}
          <span className="cite-param">tokenId</span>
          <span className="cite-comma">,{" "}</span>
          <span className="cite-type">bytes32</span>{" "}
          <span className="cite-param">hash</span>
          <span className="cite-comma">,{" "}</span>
          <span className="cite-type">uint8</span>{" "}
          <span className="cite-param">artType</span>
          <span className="cite-comma">,{" "}</span>
          <span className="cite-type">uint256</span>{" "}
          <span className="cite-param">artData</span>
          <span className="cite-paren">)</span>
          <span className="cite-arrow">&rarr;</span>
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gallery (connected, showing owned tokens)
// ---------------------------------------------------------------------------

const ALCHEMY_API_KEY = import.meta.env.VITE_ALCHEMY_API_KEY as string;

interface AlchemyResponse {
  ownedNfts: { tokenId: string }[];
  totalCount: number;
  pageKey: string | null;
}

async function fetchOwnedTokenIds(owner: string): Promise<bigint[]> {
  const params = new URLSearchParams({
    owner,
    "contractAddresses[]": HERALDIA_ADDRESS,
    withMetadata: "false",
    pageSize: "100",
  });
  const url = `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}/getNFTsForOwner?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alchemy API error: ${res.status}`);
  const data: AlchemyResponse = await res.json();
  return data.ownedNfts.map((nft) => BigInt(nft.tokenId));
}

function Gallery({
  address,
  onSelect,
}: {
  address: `0x${string}`;
  onSelect: (tokenId: bigint) => void;
}) {
  const publicClient = usePublicClient();
  const [tokens, setTokens] = useState<OwnedToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const ids = await fetchOwnedTokenIds(address);
        if (cancelled) return;

        if (ids.length === 0) {
          setTokens([]);
          setLoading(false);
          return;
        }

        // Show cards immediately, then fill in SVGs from the on-chain renderer
        setTokens(ids.map((id) => ({ tokenId: id, svg: null })));
        setLoading(false);

        const CONCURRENCY = 5;
        for (let start = 0; start < ids.length; start += CONCURRENCY) {
          const batch = ids.slice(start, start + CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(async (tokenId) => {
              const uri = await publicClient!.readContract({
                address: RENDERER_ADDRESS,
                abi: rendererAbi,
                functionName: "tokenURI",
                args: [tokenId],
              });
              return { tokenId, svg: extractSvgFromUri(uri) };
            }),
          );
          if (cancelled) return;
          setTokens((prev) =>
            prev.map((t) => {
              const match = results.find(
                (r) =>
                  r.status === "fulfilled" && r.value.tokenId === t.tokenId,
              );
              if (match && match.status === "fulfilled") {
                return { ...t, svg: match.value.svg };
              }
              return t;
            }),
          );
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load tokens");
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [publicClient, address]);

  if (loading) {
    return (
      <div className="gallery-status">
        <p>Loading your Heraldia tokens...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="gallery-status">
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className="gallery-status">
        <p>You don't own any Heraldia tokens.</p>
        <p className="hint">
          <a
            href="https://opensea.io/collection/heraldia"
            target="_blank"
            rel="noopener noreferrer"
          >
            Browse the collection on OpenSea
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="gallery">
      <h2 className="section-heading">
        Your Heraldia <span className="count">({tokens.length})</span>
      </h2>
      <div className="gallery-grid">
        {tokens.map((t) => (
          <button
            key={t.tokenId.toString()}
            className="gallery-card"
            onClick={() => onSelect(t.tokenId)}
          >
            <div className="gallery-card-art">
              {t.svg ? (
                <div dangerouslySetInnerHTML={{ __html: t.svg }} />
              ) : (
                <div className="loading">Loading</div>
              )}
            </div>
            <span className="gallery-card-label">
              #{t.tokenId.toString()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crafter (token selected)
// ---------------------------------------------------------------------------

function Crafter({
  tokenId,
  ownerAddress,
  onBack,
  readOnly = false,
}: {
  tokenId: bigint;
  ownerAddress: `0x${string}`;
  onBack: () => void;
  readOnly?: boolean;
}) {
  const [traits, setTraits] = useState<TraitSelection>({
    Theme: 0,
    Pattern: 0,
    Background: 0,
  });
  const [seed, setSeed] = useState(() => randomSeed());
  const [copied, setCopied] = useState(false);
  const [overrideHash, setOverrideHash] = useState<`0x${string}` | null>(null);
  const [targetColor, setTargetColor] = useState<string | null>(null);
  const [colorHash, setColorHash] = useState<`0x${string}` | null>(null);
  const [timeMachineTransfers, setTimeMachineTransfers] = useState(1);
  const [backToFutureDate, setBackToFutureDate] = useState("");

  const publicClient = usePublicClient();

  const {
    search: colorSearch,
    cancel: cancelColorSearch,
    searching: colorSearching,
    progress: colorProgress,
    results: colorResults,
  } = useColorSearch();

  const {
    available: sweepColors,
    colorToHash: sweepColorToHash,
    sweeping,
    progress: sweepProgress,
    hasRun: sweepHasRun,
    startSweep: rawStartSweep,
  } = useColorSweep(tokenId, ownerAddress, traits);

  const startSweep = useCallback(() => {
    track("color_scan", { theme: traits.Theme, pattern: traits.Pattern, bg: traits.Background });
    rawStartSweep();
  }, [rawStartSweep, traits]);

  const activeHash = overrideHash ?? colorHash ?? craftHash(traits, seed);

  function copyHash() {
    navigator.clipboard.writeText(activeHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleTraitChange(traitName: TraitName, value: number) {
    setOverrideHash(null);
    setColorHash(null);
    setTraits((prev) => ({ ...prev, [traitName]: value }));
  }

  function handleSeedChange(value: number) {
    setOverrideHash(null);
    setColorHash(null);
    setSeed(value);
  }

  function handleColorPick(color: string) {
    if (targetColor === color) {
      setTargetColor(null);
      setColorHash(null);
      cancelColorSearch();
      return;
    }
    if (sweepHasRun && !sweeping && sweepColors.size > 0 && !sweepColors.has(color)) return;

    setTargetColor(color);
    setOverrideHash(null);

    const knownHash = sweepColorToHash.get(color);
    if (knownHash) {
      setColorHash(knownHash);
      cancelColorSearch();
    } else {
      setColorHash(null);
      colorSearch(tokenId, ownerAddress, color, traits);
    }
  }

  function handleColorResultPick(result: { hash: `0x${string}`; svg: string }) {
    setColorHash(result.hash);
  }

  // On-chain reads — check V2 first, fall back to V1
  const { data: v2HashResult } = useReadContract({
    address: ART_SELECTION_V2_ADDRESS,
    abi: artSelectionV2Abi,
    functionName: "getActiveHash",
    args: [tokenId],
  });
  const { data: v1HashResult } = useReadContract({
    address: ART_SELECTION_ADDRESS,
    abi: artSelectionAbi,
    functionName: "getActiveHash",
    args: [tokenId],
  });
  const activeHashResult = v2HashResult?.[0] ? v2HashResult : v1HashResult;

  const { data: staticHash } = useReadContract({
    address: STORAGE_ADDRESS,
    abi: storageAbi,
    functionName: "getStaticHash",
    args: [tokenId],
  });

  const { data: transferCount } = useReadContract({
    address: STORAGE_ADDRESS,
    abi: storageAbi,
    functionName: "getTransferCount",
    args: [tokenId],
  });

  // Current on-chain artwork
  const [currentSvg, setCurrentSvg] = useState<string | null>(null);
  const [currentTraits, setCurrentTraits] = useState<
    { trait_type: string; value: string }[]
  >([]);

  // V2 Time Machine metadata (derived from on-chain traits)
  const timeMachineTrait = currentTraits.find((t) => t.trait_type === "Time Machine");
  const bttfTrait = currentTraits.find((t) => t.trait_type === "Back to the Future");
  const [loadingCurrent, setLoadingCurrent] = useState(true);

  const fetchCurrentArt = useCallback(async () => {
    if (!publicClient) return;
    setLoadingCurrent(true);
    try {
      const uri = await publicClient.readContract({
        address: RENDERER_ADDRESS,
        abi: rendererAbi,
        functionName: "tokenURI",
        args: [tokenId],
      });
      const { svg, traits } = parseTokenUri(uri);
      setCurrentSvg(svg);
      setCurrentTraits(traits);
    } catch {
      setCurrentSvg(null);
      setCurrentTraits([]);
    } finally {
      setLoadingCurrent(false);
    }
  }, [publicClient, tokenId]);

  useEffect(() => {
    fetchCurrentArt();
  }, [fetchCurrentArt]);

  // Unique owners from Transfer events
  const [uniqueOwners, setUniqueOwners] = useState<number | null>(null);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;

    async function loadOwners() {
      try {
        const logs = await publicClient!.getLogs({
          address: HERALDIA_ADDRESS,
          event: heraldiaAbi[1],
          args: { tokenId },
          fromBlock: 0n,
          toBlock: "latest",
        });
        if (cancelled) return;
        const owners = new Set(logs.map((l) => l.args.to));
        setUniqueOwners(owners.size);
      } catch {
        if (!cancelled) setUniqueOwners(null);
      }
    }

    loadOwners();
    return () => { cancelled = true; };
  }, [publicClient, tokenId]);

  // Past looks from on-chain events
  const { looks: pastLooks, loading: pastLooksLoading, refresh: refreshPastLooks } = usePastLooks(
    tokenId,
    ownerAddress,
  );

  // Preview with active hash
  const {
    preview,
    loading: previewLoading,
    error: previewError,
    result: previewResult,
  } = usePreview();

  const runPreview = useCallback(() => {
    preview(tokenId, activeHash, ownerAddress);
    track("preview", { theme: traits.Theme, pattern: traits.Pattern, bg: traits.Background });
  }, [tokenId, ownerAddress, activeHash, preview, traits]);

  useEffect(() => {
    const timer = setTimeout(runPreview, 300);
    return () => clearTimeout(timer);
  }, [runPreview]);

  // Write contracts
  const {
    writeContract: writeSelectArt,
    isPending: selectArtPending,
    data: selectArtTxHash,
    reset: resetSelectArt,
  } = useWriteContract();
  const {
    writeContract: writeResetArt,
    isPending: resetArtPending,
    data: resetArtTxHash,
    reset: resetResetArt,
  } = useWriteContract();

  const {
    isLoading: selectArtConfirming,
    isSuccess: selectArtConfirmed,
  } = useWaitForTransactionReceipt({ hash: selectArtTxHash });

  const {
    isLoading: resetArtConfirming,
    isSuccess: resetArtConfirmed,
  } = useWaitForTransactionReceipt({ hash: resetArtTxHash });

  const hasCustomArt = activeHashResult?.[0] === true;
  const onChainHash = hasCustomArt ? activeHashResult![1] : null;

  const [txMessage, setTxMessage] = useState<{ type: "success" | "info"; text: string } | null>(null);

  useEffect(() => {
    if (selectArtConfirming) {
      setTxMessage({ type: "info", text: "Transaction pending\u2026" });
    }
  }, [selectArtConfirming]);

  useEffect(() => {
    if (selectArtConfirmed) {
      setTxMessage({ type: "success", text: "Custom art applied on-chain!" });
      fetchCurrentArt();
      refreshPastLooks();
      refreshOpenSeaMetadata(tokenId);
      track("apply_art", { tokenId: String(tokenId), timeMachine: timeMachineTransfers });
      if (previewResult?.svg) {
        fetch(import.meta.env.VITE_FORGE_API_URL as string, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": import.meta.env.VITE_FORGE_API_KEY as string,
          },
          body: JSON.stringify({ tokenId: String(tokenId), hash: activeHash, svg: previewResult.svg }),
        }).catch(() => {});
      }
      const timer = setTimeout(() => {
        setTxMessage(null);
        resetSelectArt();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [selectArtConfirmed, fetchCurrentArt, refreshPastLooks, resetSelectArt, tokenId, activeHash, previewResult]);

  useEffect(() => {
    if (resetArtConfirming) {
      setTxMessage({ type: "info", text: "Transaction pending\u2026" });
    }
  }, [resetArtConfirming]);

  useEffect(() => {
    if (resetArtConfirmed) {
      setTxMessage({ type: "success", text: "Art reset to default!" });
      fetchCurrentArt();
      refreshPastLooks();
      refreshOpenSeaMetadata(tokenId);
      track("reset_art", { tokenId: String(tokenId) });
      const timer = setTimeout(() => {
        setTxMessage(null);
        resetResetArt();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [resetArtConfirmed, fetchCurrentArt, refreshPastLooks, resetResetArt]);

  function handleSelectArt() {
    setTxMessage(null);
    const artData = backToFutureDate
      ? BigInt(Math.floor(new Date(backToFutureDate).getTime() / 1000))
      : BigInt(Math.floor(Date.now() / 1000));
    writeSelectArt({
      address: ART_SELECTION_V2_ADDRESS,
      abi: artSelectionV2Abi,
      functionName: "selectArt",
      args: [tokenId, activeHash, timeMachineTransfers, artData],
    });
  }

  function handleResetArt() {
    setTxMessage(null);
    writeResetArt({
      address: ART_SELECTION_V2_ADDRESS,
      abi: artSelectionV2Abi,
      functionName: "resetArt",
      args: [tokenId],
    });
  }

  return (
    <>
      <button className="back-btn" onClick={onBack}>
        <span aria-hidden="true">&larr;</span> Gallery
      </button>

      <main>
        <section className="panel current-panel">
          <div className="panel-header">
            <h2>Current</h2>
            <span className="token-id">
              <a
                href={`https://opensea.io/assets/ethereum/${HERALDIA_ADDRESS}/${tokenId}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on OpenSea"
              >
                #{tokenId.toString()}
              </a>
            </span>
          </div>
          <div className="svg-frame">
            {loadingCurrent ? (
              <div className="loading">Loading</div>
            ) : currentSvg ? (
              <div dangerouslySetInnerHTML={{ __html: currentSvg }} />
            ) : (
              <div className="empty">No artwork</div>
            )}
          </div>
          <div className="info-grid">
            <span className="label">Owner</span>
            <span className="value mono">
              <Copyable value={ownerAddress} display={truncAddr(ownerAddress)} />
            </span>
            <span className="label">Static Hash</span>
            <span className="value mono">
              {staticHash
                ? <Copyable value={staticHash} display={truncHash(staticHash)} />
                : "\u2014"}
            </span>
            <span className="label">Transfers</span>
            <span className="value">
              {transferCount !== undefined ? String(transferCount) : "\u2014"}
            </span>
            <span className="label">Unique Owners</span>
            <span className="value">
              {uniqueOwners !== null ? String(uniqueOwners) : "\u2014"}
            </span>
            <span className="label">Custom Art</span>
            <span className="value mono">
              {hasCustomArt
                ? <Copyable value={activeHashResult![1]} display={truncHash(activeHashResult![1])} />
                : "None"}
            </span>
            {timeMachineTrait && (
              <>
                <span className="label">Time Machine</span>
                <span className="value">{timeMachineTrait.value}</span>
              </>
            )}
            {bttfTrait && (
              <>
                <span className="label">Back to the Future</span>
                <span className="value">{bttfTrait.value}</span>
              </>
            )}
          </div>
          <div className="trait-list">
            {currentTraits
              .filter((t) => t.trait_type !== "Time Machine" && t.trait_type !== "Back to the Future")
              .map((t) => (
                <div key={t.trait_type} className="trait-row">
                  <span className="trait-name">{t.trait_type}</span>
                  <span className="trait-value">{t.value}</span>
                </div>
              ))}
          </div>

          {pastLooks.length > 0 && (
            <div className="past-looks">
              <h3 className="past-looks-heading">
                Past Looks{" "}
                <span className="count">({pastLooks.length})</span>
              </h3>
              <div className="past-looks-grid">
                {pastLooks.map((look) => (
                  <button
                    key={look.hash}
                    className={`past-look-card${onChainHash === look.hash ? " active" : ""}${overrideHash === look.hash ? " selected" : ""}`}
                    onClick={() => { setOverrideHash(look.hash); track("past_look", { tokenId: String(tokenId) }); }}
                    title={look.hash}
                  >
                    <div className="past-look-art">
                      {look.svg ? (
                        <div
                          dangerouslySetInnerHTML={{ __html: look.svg }}
                        />
                      ) : (
                        <div className="loading">...</div>
                      )}
                    </div>
                    <span className="past-look-label">
                      {look.hash.slice(0, 6)}&hellip;{look.hash.slice(-4)}
                    </span>
                  </button>
                ))}
              </div>
              {pastLooksLoading && (
                <p className="past-looks-status">Loading previews&hellip;</p>
              )}
            </div>
          )}
        </section>

        <section className="panel craft-panel">
          <div className="panel-header">
            <h2>Preview</h2>
            {overrideHash && (
              <button
                className="override-clear"
                onClick={() => setOverrideHash(null)}
              >
                Back to crafter
              </button>
            )}
          </div>

          {!overrideHash && (
            <div className="controls">
              {(Object.keys(TRAIT_MAP) as TraitName[]).map((traitName) => (
                <div key={traitName} className="control-row">
                  <label>{traitName}</label>
                  <select
                    value={traits[traitName]}
                    onChange={(e) =>
                      handleTraitChange(traitName, Number(e.target.value))
                    }
                  >
                    {TRAIT_MAP[traitName].options.map((opt) => (
                      <option key={opt.index} value={opt.index}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              <div className="control-row">
                <label>Variation Seed</label>
                <div className="seed-input">
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => handleSeedChange(Number(e.target.value))}
                  />
                  <button
                    onClick={() => handleSeedChange(randomSeed())}
                    title="Randomize variation seed"
                    aria-label="Randomize variation seed"
                  >
                    ↻
                  </button>
                </div>
              </div>

              <div className="color-picker-section">
                <label>
                  Find Color
                  {targetColor && (
                    <span
                      className="color-active-dot"
                      style={{ background: targetColor }}
                    />
                  )}
                  {!sweeping && sweepColors.size > 0 && (
                    <span className="sweep-status sweep-done">
                      {sweepColors.size} colors
                      <button
                        className="sweep-refresh"
                        onClick={startSweep}
                        title="Rescan for different colors"
                        aria-label="Rescan colors"
                      >
                        ↻
                      </button>
                    </span>
                  )}
                </label>
                {!sweepHasRun && !sweeping ? (
                  <button
                    className="btn-sweep"
                    onClick={startSweep}
                  >
                    🎨 Scan Available Colors
                  </button>
                ) : (
                  <div className="color-swatches-wrap">
                    {sweeping && (
                      <div className="color-swatches-overlay">
                        <span className="tx-spinner" />
                        Scanning… {Math.round(sweepProgress * 100)}%
                      </div>
                    )}
                    <div className={`color-swatches${sweeping ? " scanning" : ""}`}>
                      {ACCENT_COLORS.map((c) => {
                        const reachable = sweepColors.has(c);
                        const dimmed = !sweeping && sweepColors.size > 0 && !reachable;
                        return (
                          <button
                            key={c}
                            className={`color-swatch${targetColor === c ? " selected" : ""}${dimmed ? " dimmed" : ""}`}
                            style={{ background: c }}
                            onClick={() => !sweeping && handleColorPick(c)}
                            title={`${c}${dimmed ? " (not found for these traits)" : ""}`}
                            aria-label={`Pick color ${c}`}
                            disabled={sweeping}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
                {colorSearching && (
                  <div className="color-search-status">
                    <span className="tx-spinner" />
                    Searching… {colorProgress.tested} tested, {colorProgress.found} found
                    <button
                      className="color-search-cancel"
                      onClick={() => { cancelColorSearch(); setTargetColor(null); }}
                    >
                      ✕
                    </button>
                  </div>
                )}
                {!colorSearching && targetColor && colorResults.length === 0 && colorProgress.tested > 0 && (
                  <div className="color-search-status color-search-empty">
                    No matches found. Try different traits or search again.
                  </div>
                )}
                {colorResults.length > 0 && (
                  <div className="color-results">
                    <span className="color-results-label">
                      {colorResults.length} match{colorResults.length !== 1 ? "es" : ""}
                    </span>
                    <div className="color-results-grid">
                      {colorResults.map((r) => (
                        <button
                          key={r.hash}
                          className={`color-result-card${overrideHash === r.hash ? " selected" : ""}`}
                          onClick={() => handleColorResultPick(r)}
                          title={r.hash}
                        >
                          <div
                            className="color-result-art"
                            dangerouslySetInnerHTML={{ __html: r.svg }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="control-row">
                <label>
                  Time Machine
                  <span className="control-hint" title="How many transfers your custom art survives before reverting">
                    &#9432;
                  </span>
                </label>
                <div className="time-machine-control">
                  <input
                    type="range"
                    min={1}
                    max={16}
                    value={timeMachineTransfers}
                    onChange={(e) => setTimeMachineTransfers(Number(e.target.value))}
                  />
                  <span className="time-machine-value">
                    {timeMachineTransfers === 1
                      ? "1 transfer"
                      : `${timeMachineTransfers} transfers`}
                  </span>
                </div>
              </div>

              <div className="control-row">
                <label>
                  Back to the Future
                  <span className="control-hint" title="Optional commemorative date stored on-chain with your art">
                    &#9432;
                  </span>
                </label>
                <input
                  type="date"
                  className="bttf-date"
                  value={backToFutureDate}
                  onChange={(e) => setBackToFutureDate(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="svg-frame">
            {previewLoading ? (
              <div className="loading">Previewing</div>
            ) : previewError ? (
              <div className="error">{previewError}</div>
            ) : previewResult?.svg ? (
              <div dangerouslySetInnerHTML={{ __html: previewResult.svg }} />
            ) : (
              <div className="empty">Select traits to preview</div>
            )}
          </div>

          {previewResult && (
            <div className="trait-list">
              {previewResult.traits.map((t) => (
                <div key={t.trait_type} className="trait-row">
                  <span className="trait-name">{t.trait_type}</span>
                  <span className="trait-value">{t.value}</span>
                </div>
              ))}
            </div>
          )}

          <div className="hash-display">
            <label>
              <span>{overrideHash ? "Past Hash" : colorHash ? "Color Match" : "Crafted Hash"}</span>
              {copied && <span className="copy-status">Copied</span>}
            </label>
            <code
              className="hash"
              onClick={copyHash}
              title="Click to copy"
            >
              {activeHash}
            </code>
          </div>

          {txMessage && (
            <div className={`tx-message tx-${txMessage.type}`}>
              {txMessage.type === "info" && <span className="tx-spinner" />}
              {txMessage.text}
            </div>
          )}

          {!readOnly && (
            <div className="actions">
              <button
                className="btn-primary"
                onClick={handleSelectArt}
                disabled={selectArtPending || selectArtConfirming}
              >
                {selectArtPending
                  ? "Confirm in wallet\u2026"
                  : selectArtConfirming
                    ? "Mining\u2026"
                    : "Apply On-Chain"}
              </button>
              <button
                className="btn-secondary"
                onClick={handleResetArt}
                disabled={!hasCustomArt || resetArtPending || resetArtConfirming}
                title={!hasCustomArt ? "No custom art to reset" : ""}
              >
                {resetArtPending
                  ? "Confirm in wallet\u2026"
                  : resetArtConfirming
                    ? "Mining\u2026"
                    : "Reset Art"}
              </button>
            </div>
          )}
          {readOnly && (
            <p className="explore-hint">
              Connect your wallet to apply changes on-chain.
            </p>
          )}
        </section>
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------

type Page = "home" | "faq" | "tech";

function useExploreToken(): { tokenId: bigint; owner: `0x${string}` } | null {
  const param = new URLSearchParams(window.location.search).get("tokenId");
  const tokenId = param ? BigInt(param) : null;

  const { data: owner } = useReadContract(
    tokenId !== null
      ? {
          address: HERALDIA_ADDRESS,
          abi: heraldiaAbi,
          functionName: "ownerOf",
          args: [tokenId],
        }
      : undefined,
  );

  if (tokenId === null || !owner) return null;
  return { tokenId, owner: owner as `0x${string}` };
}

function App() {
  const { address } = useAccount();
  const [selectedToken, setSelectedToken] = useState<bigint | null>(null);
  const [theme, toggleTheme] = useTheme();
  const [page, setPageRaw] = useState<Page>(() => {
    const p = new URLSearchParams(window.location.search).get("page");
    if (p === "faq" || p === "tech") return p;
    return "home";
  });
  const setPage = useCallback((p: Page) => {
    setPageRaw(p);
    const url = new URL(window.location.href);
    if (p === "home") url.searchParams.delete("page");
    else url.searchParams.set("page", p);
    window.history.replaceState({}, "", url.toString());
  }, []);
  const exploreToken = useExploreToken();

  useEffect(() => {
    if (!address) setSelectedToken(null);
    else track("wallet_connect");
  }, [address]);

  useEffect(() => {
    if (address) {
      const pattern = generateWalletPattern(address, theme);
      document.body.style.backgroundImage = pattern;
      document.body.style.backgroundRepeat = "repeat";
      document.body.style.backgroundAttachment = "fixed";
    } else {
      document.body.style.backgroundImage = "";
    }
    return () => { document.body.style.backgroundImage = ""; };
  }, [address, theme]);

  const showFaq = page === "faq";
  const showTech = page === "tech";

  return (
    <div className="app">
      <header>
        <h1>Herald&rsquo;s Forge</h1>
        <div className="header-actions">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>
          {address && (
            <ConnectButton
              showBalance={false}
              accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
              chainStatus="none"
            />
          )}
        </div>
      </header>

      {showFaq ? (
        <FAQPage onBack={() => setPage("home")} />
      ) : showTech ? (
        <TechPage onBack={() => setPage("home")} />
      ) : (
        <>
          {!address && !exploreToken && <Landing onFaq={() => setPage("faq")} />}

          {!address && exploreToken && (
            <Crafter
              tokenId={exploreToken.tokenId}
              ownerAddress={exploreToken.owner}
              onBack={() => { window.history.replaceState({}, "", window.location.pathname); window.location.reload(); }}
              readOnly
            />
          )}

          {address && !selectedToken && (
            <Gallery address={address} onSelect={setSelectedToken} />
          )}

          {address && selectedToken !== null && (
            <Crafter
              tokenId={selectedToken}
              ownerAddress={address}
              onBack={() => setSelectedToken(null)}
            />
          )}
        </>
      )}

      <footer className="app-footer">
        <span>Forged on Ethereum</span>
        <span className="footer-sep">&middot;</span>
        <a
          href={`https://etherscan.io/address/${HERALDIA_ADDRESS}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {HERALDIA_ADDRESS.slice(0, 6)}&hellip;{HERALDIA_ADDRESS.slice(-4)}
        </a>
        <span className="footer-sep">&middot;</span>
        <button className="footer-link" onClick={() => { setPage(page === "faq" ? "home" : "faq"); window.scrollTo(0, 0); }}>
          FAQ
        </button>
        <span className="footer-sep">&middot;</span>
        <button className="footer-link" onClick={() => { setPage(page === "tech" ? "home" : "tech"); window.scrollTo(0, 0); }}>
          Technical Details
        </button>
        <span className="footer-sep">&middot;</span>
        <a
          href="https://github.com/thoerner/heralds-forge"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        <DonateWithQR />
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractSvgFromUri(uri: string): string | null {
  try {
    const jsonB64 = uri.replace("data:application/json;base64,", "");
    const metadata = JSON.parse(atob(jsonB64));
    const img = metadata.image as string;
    if (img?.startsWith("data:image/svg+xml;base64,")) {
      return atob(img.replace("data:image/svg+xml;base64,", ""));
    }
    if (img?.startsWith("data:image/svg+xml,")) {
      return decodeURIComponent(img.replace("data:image/svg+xml,", ""));
    }
  } catch {}
  return null;
}

function parseTokenUri(uri: string): {
  svg: string | null;
  traits: { trait_type: string; value: string }[];
} {
  try {
    const jsonB64 = uri.replace("data:application/json;base64,", "");
    const metadata = JSON.parse(atob(jsonB64));
    const svg = extractSvgFromUri(uri);
    const traits = (metadata.attributes ?? []) as {
      trait_type: string;
      value: string;
    }[];
    return { svg, traits };
  } catch {
    return { svg: null, traits: [] };
  }
}

function truncAddr(addr: string): string {
  return addr.slice(0, 6) + "\u2026" + addr.slice(-4);
}

function truncHash(hash: string): string {
  return hash.slice(0, 10) + "\u2026" + hash.slice(-6);
}

export default App;
