import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import ipaddr from "ipaddr.js";

export type AddressLookup = (host: string) => Promise<string[]>;
export const dnsAddresses: AddressLookup = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

function isLocalhost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

export async function checkedDestination(raw: string, allowLocalHttp: boolean, resolve: AddressLookup = dnsAddresses) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("The callback URL is not valid."); }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const localDemo = allowLocalHttp && url.protocol === "http:" && isLocalhost(host);
  if (!localDemo && url.protocol !== "https:") throw new Error("The callback URL needs HTTPS.");
  if (url.username || url.password || url.hash) throw new Error("The callback URL has unsupported parts.");
  if (url.port && Number(url.port) < 1) throw new Error("The callback port is not valid.");
  const addresses = net.isIP(host) ? [host] : await resolve(host);
  if (!addresses.length) throw new Error("The callback host has no address.");
  if (addresses.some((address) => !isPublicAddress(address)) && !localDemo) {
    throw new Error("The callback host has a non-public address.");
  }
  if (localDemo && addresses.some((address) => !["127.0.0.1", "::1"].includes(address))) {
    throw new Error("The local callback must use a loopback address.");
  }
  return { url, address: addresses[0], localDemo };
}

export async function postChecked(
  raw: string,
  body: string,
  headers: Record<string, string>,
  allowLocalHttp: boolean,
  resolve: AddressLookup = dnsAddresses,
): Promise<{ status: number; body: string }> {
  const target = await checkedDestination(raw, allowLocalHttp, resolve);
  const transport = target.localDemo ? http : https;
  return await new Promise((fulfill, reject) => {
    const request = transport.request(target.url, {
      method: "POST",
      lookup: (_host, _options, callback) => callback(null, target.address, net.isIP(target.address)),
      headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
      timeout: 10_000,
      agent: false,
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16 * 1024) response.destroy(new Error("The callback response is too large."));
        else chunks.push(chunk);
      });
      response.on("end", () => fulfill({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("The callback timed out.")));
    request.on("error", reject);
    request.end(body);
  });
}
