/**
 * Trust-proxy configuration.
 *
 * When the app runs behind a load balancer or reverse proxy, Express only
 * reports the real client address in `req.ip` if it is told which proxies to
 * trust. IP-keyed rate limiting and request logging both depend on this.
 *
 * `TRUST_PROXY` accepts:
 *   - a hop count, e.g. "1" (trust the single proxy in front of the app)
 *   - a boolean, "true" / "false"
 *   - a comma-separated list of trusted subnets/IPs, e.g. "10.0.0.0/8,172.16.0.0/12"
 *
 * Returning `undefined` for an unset value lets the caller leave Express's
 * default in place (trust nothing, so `req.ip` is the direct peer).
 */
export type TrustProxyValue = number | string | boolean;

export function parseTrustProxy(raw: string | undefined): TrustProxyValue | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
