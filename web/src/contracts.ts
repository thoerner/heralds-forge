import { type Abi } from "viem";

export const HERALDIA_ADDRESS =
  "0x11A7E42036F8D039b0ce54b5488E3df0dfF6Cf36" as const;
export const RENDERER_ADDRESS =
  "0x2F76c69838eCAd1D7AfD318bE7a31754e045e760" as const;
export const ART_SELECTION_ADDRESS =
  "0x3Af98Fb4dC151AF77C6bE0012Efa165033E88769" as const;
export const ART_SELECTION_V2_ADDRESS =
  "0x1d6e96E9E89548807865b873261e090245dFCAcC" as const;
export const STORAGE_ADDRESS =
  "0x0D562A65d3A209738Eba9601A88Bb0A62bc66391" as const;

export const heraldiaAbi = [
  {
    type: "function",
    name: "ownerOf",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const satisfies Abi;

export const rendererAbi = [
  {
    type: "function",
    name: "tokenURI",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

export const artSelectionAbi = [
  {
    type: "function",
    name: "getActiveHash",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "isActive", type: "bool" },
      { name: "customHash", type: "bytes32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "selectArt",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "customHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "resetArt",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "ArtSelected",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "selectedBy", type: "address", indexed: true },
      { name: "customHash", type: "bytes32", indexed: false },
    ],
  },
] as const satisfies Abi;

export const artSelectionV2Abi = [
  {
    type: "function",
    name: "getActiveHash",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "isActive", type: "bool" },
      { name: "customHash", type: "bytes32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasCustomArt",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "selectArt",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "customHash", type: "bytes32" },
      { name: "artType", type: "uint8" },
      { name: "artData", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "resetArt",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "ArtSelected",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "selectedBy", type: "address", indexed: true },
      { name: "customHash", type: "bytes32", indexed: false },
      { name: "artType", type: "uint8", indexed: false },
      { name: "artData", type: "uint256", indexed: false },
    ],
  },
] as const satisfies Abi;

export const storageAbi = [
  {
    type: "function",
    name: "getStaticHash",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getTransferCount",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

// Trait map derived from empirical probing (output/trait-map.json)
export const TRAIT_MAP = {
  Theme: {
    byte: 0,
    modulus: 2,
    options: [
      { index: 0, label: "Sun" },
      { index: 1, label: "Moon" },
    ],
  },
  Pattern: {
    byte: 1,
    modulus: 4,
    options: [
      { index: 0, label: "Pixel" },
      { index: 1, label: "Dot" },
      { index: 2, label: "Cross" },
      { index: 3, label: "Mix" },
    ],
  },
  Background: {
    byte: 2,
    modulus: 21,
    options: [
      { index: 0, label: "Solid" },
      { index: 1, label: "Flat Bold" },
      { index: 2, label: "Flat Medium" },
      { index: 3, label: "Flat Regular" },
      { index: 4, label: "Flat Light" },
      { index: 5, label: "Upright Bold" },
      { index: 6, label: "Upright Medium" },
      { index: 7, label: "Upright Regular" },
      { index: 8, label: "Upright Light" },
      { index: 9, label: "Slant Bold" },
      { index: 10, label: "Slant Medium" },
      { index: 11, label: "Slant Regular" },
      { index: 12, label: "Slant Light" },
      { index: 13, label: "Grid Bold" },
      { index: 14, label: "Grid Medium" },
      { index: 15, label: "Grid Regular" },
      { index: 16, label: "Grid Light" },
      { index: 17, label: "Dot Bold" },
      { index: 18, label: "Dot Medium" },
      { index: 19, label: "Dot Regular" },
      { index: 20, label: "Dot Light" },
    ],
  },
} as const;

export type TraitName = keyof typeof TRAIT_MAP;
