// Donations ("Apoiar" button). Fill in at least one of the two to show the
// button; it stays hidden while both are empty. After changing the PIX
// data, run `npm run build-pages` (it draws pix-qr.svg, the QR code).
export default {
  // PIX, for visitors in Brazil. name and city as registered at the bank:
  // the BR Code carries them and some bank apps check them.
  pix: { key: "", name: "", city: "" },
  // For everyone else (card/PayPal): the address of your page on Ko-fi,
  // Buy Me a Coffee, PayPal.me, GitHub Sponsors… and its name.
  link: { url: "", label: "" },
};
