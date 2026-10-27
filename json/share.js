// Share links: the input text, deflated and base64url-encoded, goes in the
// URL's #fragment, which browsers never send to the server.

export const SHARE_PREFIX = "#json=";

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeShare(text) {
  const bytes = await pipe(new TextEncoder().encode(text), new CompressionStream("deflate-raw"));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function decodeShare(code) {
  const binary = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(await pipe(bytes, new DecompressionStream("deflate-raw")));
}
