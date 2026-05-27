require('dotenv').config();
const {
  default: makeWASocket,
  DisconnectReason,
  
  fetchLatestBaileysVersion,
  makeInMemoryStore,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const { useMongoDB } = require('baileys-mongo');
const mongoose = require('mongoose');

const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
const PREFIX = '/';
const BOT_NAME = 'lixx-bayles';

async function startBot() {
  
  // MongoDB Auth
  await mongoose.connect(process.env.MONGO_URI);
  const { state, saveCreds } = await useMongoDB(process.env.MONGO_URI, 'auth');


  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    printQRInTerminal: true,
    browser: [BOT_NAME, 'Chrome', '1.0'],
  });

  store.bind(sock.ev);

  // ─── Connection Update ──────────────────────────────────────────────────────
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr: newQR }) => {
    
    if (connection === 'open') {
      console.log('\n✅ WhatsApp Connected!');
    }
    if (newQR) {
      qrcode.generate(newQR, { small: true });
    }
    if (!sock.authState.creds.registered) {
      const phoneNumber = process.env.PHONE_NUMBER;
      if (phoneNumber) {
        const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
        console.log('\n🔑 Pairing Code:', code);
      }
    }

    if (connection === 'close') {
      const shouldReconnect =
        new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Koneksi terputus, reconnect:', shouldReconnect);
      if (shouldReconnect) startBot();
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ─── Message Handler ────────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const m of messages) {
      if (!m.message || m.key.fromMe) continue;

      const from = m.key.remoteJid;
      const isGroup = from.endsWith('@g.us');
      const sender = isGroup ? m.key.participant : from;
      const body = m.message?.conversation
        || m.message?.extendedTextMessage?.text
        || m.message?.imageMessage?.caption
        || m.message?.videoMessage?.caption
        || '';

      // Group info
      let participants = [];
      if (isGroup) {
        const metadata = await sock.groupMetadata(from).catch(() => null);
        participants = metadata?.participants || [];
      }

      if (!body.startsWith(PREFIX) && PREFIX !== '') continue;

      const args = body.slice(PREFIX.length).trim().split(' ');
      const cmd = args[0].toLowerCase();

      try {
        
      } catch (e) {
        console.error('Error command:', e);
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: m });
      }
    }
  });

  

  console.log(`🚀 ${BOT_NAME} siap!`);
  return sock;
}

startBot().catch(console.error);
