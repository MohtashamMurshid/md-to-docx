import { BlockList, isIP } from "node:net";

/**
 * Private-network classification for the remote image fetcher's SSRF policy.
 * Every resolved or literal address must pass `isBlockedIpAddress` before a
 * connection is made to it.
 */

/**
 * Blocked IPv4 ranges, matched exactly, as are the IPv6 forms that carry an
 * IPv4 address.
 */
const BLOCKED_IPV4_CIDRS: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata endpoints
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation (TEST-NET-1)
  ["192.88.99.0", 24], // 6to4 relay anycast, deprecated
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation (TEST-NET-2)
  ["203.0.113.0", 24], // documentation (TEST-NET-3)
  ["224.0.0.0", 3], // multicast and reserved, including broadcast
];

/** Global unicast: the only IPv6 space that holds public hosts. */
const GLOBAL_UNICAST: readonly [string, number] = ["2000::", 3];

/** Parts of global unicast that never reach a public host directly. */
const BLOCKED_GLOBAL_UNICAST: readonly (readonly [string, number])[] = [
  ["2001::", 32], // Teredo tunnels, which reach arbitrary IPv4 hosts
  ["2001:2::", 48], // benchmarking
  ["2001:10::", 28], // ORCHID, deprecated
  ["2001:20::", 28], // ORCHIDv2
  ["2001:db8::", 32], // documentation
  ["3fff::", 20], // documentation (RFC 9637)
];

/**
 * IPv6 forms that carry an IPv4 address in their last 32 bits, accepted only
 * when that IPv4 address is public: IPv4-mapped addresses, and the NAT64
 * well-known prefix that DNS64 resolvers return on IPv6-only networks.
 */
const IPV4_CARRIERS: readonly (readonly [string, number])[] = [
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
];

function ipv4Hextets(address: string): [string, string] {
  const [a = 0, b = 0, c = 0, d = 0] = address.split(".").map(Number);
  return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
}

function blockList(
  networks: Iterable<readonly [string, number]>,
  family: "ipv4" | "ipv6" = "ipv6",
): BlockList {
  const list = new BlockList();
  for (const [network, prefix] of networks) {
    list.addSubnet(network, prefix, family);
  }
  return list;
}

const BLOCKED_IPV4 = blockList(BLOCKED_IPV4_CIDRS, "ipv4");

function isPrivateIPv4(address: string): boolean {
  return BLOCKED_IPV4.check(address, "ipv4");
}

/** Each blocked IPv4 range, as it appears inside every IPv4-carrying form. */
function* embeddedBlockedIpv4(): Generator<readonly [string, number]> {
  for (const [network, prefix] of BLOCKED_IPV4_CIDRS) {
    const [high, low] = ipv4Hextets(network);
    yield [`::ffff:${high}:${low}`, 96 + prefix];
    yield [`64:ff9b::${high}:${low}`, 96 + prefix];
    yield [`2002:${high}:${low}::`, 16 + prefix]; // 6to4
  }
}

// BlockList matches addresses numerically, so every spelling of an address
// (`::1`, `0:0:0:0:0:0:0:1`, `::ffff:127.0.0.1`, `::ffff:7f00:1`) gets one answer.
const PUBLIC_IPV6 = blockList([GLOBAL_UNICAST, ...IPV4_CARRIERS]);
const BLOCKED_IPV6 = blockList([
  ...BLOCKED_GLOBAL_UNICAST,
  ...embeddedBlockedIpv4(),
]);

/** Blocked unless it is global unicast, or carries a public IPv4 address. */
function isPrivateIPv6(address: string): boolean {
  const [withoutZone = ""] = address.split("%");
  return (
    !PUBLIC_IPV6.check(withoutZone, "ipv6") ||
    BLOCKED_IPV6.check(withoutZone, "ipv6")
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
