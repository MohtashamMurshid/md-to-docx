import { isIP } from "node:net";

/**
 * Private-network classification for the remote image fetcher's SSRF policy.
 * Every resolved or literal address must pass `isBlockedIpAddress` before a
 * connection is made to it.
 */

interface Ipv4Network {
  firstOctet: number;
  secondOctetMin: number;
  secondOctetMax: number;
}

/**
 * Parses a CIDR block no longer than /16, so a block is matched on the first
 * two octets alone. A /8 says nothing about the second octet, so it matches
 * any second octet the parser accepted, in range or not.
 */
function parseIpv4Network(cidr: string): Ipv4Network {
  const [address, prefix] = cidr.split("/");
  const [firstOctet, secondOctet] = address!.split(".").map(Number);
  const prefixLength = Number(prefix);
  const wholeSecondOctet = prefixLength <= 8;
  return {
    firstOctet: firstOctet!,
    secondOctetMin: wholeSecondOctet ? -Infinity : secondOctet!,
    secondOctetMax: wholeSecondOctet
      ? Infinity
      : secondOctet! + 2 ** (16 - prefixLength) - 1,
  };
}

const BLOCKED_IPV4_NETWORKS: readonly Ipv4Network[] = [
  "0.0.0.0/8", // "this network"
  "10.0.0.0/8", // private
  "100.64.0.0/10", // carrier-grade NAT
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local, including cloud metadata endpoints
  "172.16.0.0/12", // private
  "192.168.0.0/16", // private
  "198.18.0.0/15", // benchmarking
].map(parseIpv4Network);

/**
 * 224.0.0.0/4 (multicast) and 240.0.0.0/4 (reserved, including broadcast).
 * Any first octet from here up is blocked, out-of-range values included.
 */
const FIRST_MULTICAST_OCTET = 224;

function inIpv4Network(
  network: Ipv4Network,
  firstOctet: number,
  secondOctet: number,
): boolean {
  return (
    firstOctet === network.firstOctet &&
    secondOctet >= network.secondOctetMin &&
    secondOctet <= network.secondOctetMax
  );
}

/** Anything that is not four integer parts fails closed. */
function isPrivateIPv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const firstOctet = octets[0]!;
  const secondOctet = octets[1]!;
  return (
    firstOctet >= FIRST_MULTICAST_OCTET ||
    BLOCKED_IPV4_NETWORKS.some((network) =>
      inIpv4Network(network, firstOctet, secondOctet),
    )
  );
}

/** Parses one hextet; undefined unless it is a number in [0, 0xffff]. */
function parseHextet(hex: string): number | undefined {
  const value = parseInt(hex, 16);
  return value >= 0 && value <= 0xffff ? value : undefined;
}

function ipv6HextetsToIpv4(hiHex: string, loHex: string): string | undefined {
  const hi = parseHextet(hiHex);
  const lo = parseHextet(loHex);
  if (hi === undefined || lo === undefined) {
    return undefined;
  }
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

/**
 * True when `address` is IPv4-in-IPv6 (RFC 4291 §2.5.5.2): 80 zero bits + 16
 * bits 0xffff + 32-bit IPv4 encoded as dotted decimal or final two hextets.
 */
function ipv4EmbeddedInIpv4MappedAddress(address: string): string | undefined {
  const n = address.toLowerCase().split("%")[0]!;

  const dotted = n.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1]!;

  const hexTail = n.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexTail) return ipv6HextetsToIpv4(hexTail[1]!, hexTail[2]!);

  const hexLong = n.match(
    /^(?:0:){5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/
  );
  if (hexLong) return ipv6HextetsToIpv4(hexLong[1]!, hexLong[2]!);

  return undefined;
}

/** Unspecified (::/128) and loopback (::1/128), in canonical form. */
const BLOCKED_IPV6_ADDRESSES: ReadonlySet<string> = new Set(["::", "::1"]);

/**
 * Matched as text prefixes of the lowercased address, as resolvers print it:
 * fe80::/10 link-local (as `fe80:`), fc00::/7 unique-local (as `fc` and `fd`)
 * and ff00::/8 multicast (as `ff`).
 */
const BLOCKED_IPV6_PREFIXES: readonly string[] = ["fe80:", "fc", "fd", "ff"];

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0]!;
  const mappedV4 = ipv4EmbeddedInIpv4MappedAddress(normalized);
  if (mappedV4) {
    return isPrivateIPv4(mappedV4);
  }

  return (
    BLOCKED_IPV6_ADDRESSES.has(normalized) ||
    BLOCKED_IPV6_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

/** True unless `address` is a public IPv4 or IPv6 address. */
export function isBlockedIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isPrivateIPv4(address);
  }
  if (family === 6) {
    return isPrivateIPv6(address);
  }
  return true;
}
