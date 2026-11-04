// PIX "copia e cola" (BR Code) for a static PIX with no amount: the payer's
// bank app reads it from the QR code or the pasted text. EMV fields as in
// the Banco Central's BR Code manual; no DOM (used by app.js, the page
// builder and tests/).

const field = (id, value) => id + String(value.length).padStart(2, "0") + value;

// Names and cities go without accents (some bank apps reject them).
const plain = (text, max) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, max);

// CRC16-CCITT (polynomial 0x1021, start 0xFFFF), as 4 hex digits.
function crc16(text) {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// key: the PIX key (e-mail, phone as +55..., CPF/CNPJ digits or random key);
// name and city: the receiver's, as registered at the bank.
export function pixPayload({ key, name, city, txid = "***" }) {
  const payload =
    field("00", "01") +
    field("26", field("00", "br.gov.bcb.pix") + field("01", key.trim())) +
    field("52", "0000") +
    field("53", "986") +
    field("58", "BR") +
    field("59", plain(name, 25)) +
    field("60", plain(city, 15)) +
    field("62", field("05", txid)) +
    "6304";
  return payload + crc16(payload);
}
