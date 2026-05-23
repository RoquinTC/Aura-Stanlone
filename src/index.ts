import { Bot, Context } from 'grammy';
import { PairingService } from './agent/pairing.js';
import { quidSync } from './services/quid-sync.js';
import { VoiceService } from './services/voice.ts';
import { createImageHandler, getCryptoPrice, webSearch, readPdf } from './tools/index.js';
import http from 'http';
import { InputFile } from 'grammy';
import fs from 'fs';

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

// ── Comandos ──────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  const tgId = ctx.from?.id;
  if (!tgId) return;

  const user = await quidSync.getUserByTelegram(tgId);

  if (!user) {
    const code = PairingService.generateCode(tgId);
    await ctx.reply(`¡Hola! Soy Aura 🌸. Veo que aún no somos amigos oficiales.\n\nPara conocernos, ve a la App de Quid y usa este código de vinculación:\n\n👉 *${code}*\n\n⚠️ Tienes 10 minutos para usarlo antes de que expire. ¡Te espero allá!`, { parse_mode: 'Markdown' });
    return;
  }

  await ctx.reply(`¡Hola de nuevo, ${user.name || 'Robin'}! 💖 ¿En qué vamos a trabajar hoy?`);
});

bot.command('skills', async (ctx) => {
  await ctx.reply(
    `🌸 *Mis habilidades disponibles:*\n\n` +
    `🎨 *Crear imágenes* — "Aura, dibuja un gato astronauta"\n` +
    `💰 *Precio de cripto* — "¿Cuánto vale el Bitcoin?"\n` +
    `🔍 *Buscar en internet* — "Busca noticias sobre IA"\n` +
    `📄 *Leer PDFs* — Envíame un archivo PDF\n` +
    `🎙️ *Notas de voz* — Mándame un audio y te respondo en audio\n` +
    `💬 *Chat general* — ¡Conversemos!`,
    { parse_mode: 'Markdown' }
  );
});

// ── Dispatcher de Tools ────────────────────────────────────────────────────────

/**
 * Detecta si el mensaje requiere una tool específica y la ejecuta directamente.
 * Evita pasar por el LLM para tareas simples y determinísticas.
 */
async function tryDispatchTool(ctx: Context, text: string): Promise<boolean> {
  const lower = text.toLowerCase();

  // 🎨 Generación de imágenes
  const imageKeywords = ['dibuja', 'genera una imagen', 'crea una imagen', 'pinta', 'ilustra', 'hazme una foto de'];
  if (imageKeywords.some(k => lower.includes(k))) {
    await ctx.replyWithChatAction('upload_photo');
    // Enviamos el prompt directamente, el handler traduce al inglés internamente via el URL
    const englishPrompt = text.replace(/^(dibuja|genera|crea|pinta|ilustra|hazme)[^:]*[:\s]*/i, '').trim();
    await createImageHandler(ctx, { prompt: text, english_prompt: englishPrompt || text });
    return true;
  }

  // 💰 Precio de criptomonedas
  const cryptoKeywords = ['bitcoin', 'ethereum', 'solana', 'cripto', 'btc', 'eth', 'sol', 'precio de'];
  if (cryptoKeywords.some(k => lower.includes(k))) {
    await ctx.replyWithChatAction('typing');
    let coin = 'bitcoin';
    if (lower.includes('ethereum') || lower.includes('eth')) coin = 'ethereum';
    else if (lower.includes('solana') || lower.includes('sol')) coin = 'solana';
    else if (lower.includes('dogecoin') || lower.includes('doge')) coin = 'dogecoin';
    const result = await getCryptoPrice(coin);
    await ctx.reply(result, { parse_mode: 'Markdown' });
    return true;
  }

  // 🔍 Búsqueda web
  const searchKeywords = ['busca', 'buscar', 'investiga', 'qué dice internet sobre', 'noticias de', 'qué pasó con'];
  if (searchKeywords.some(k => lower.includes(k))) {
    await ctx.replyWithChatAction('typing');
    const query = text.replace(/^(busca|buscar|investiga|qué dice internet sobre|noticias de|qué pasó con)\s*/i, '').trim();
    const result = await webSearch(query || text);
    await ctx.reply(result, { parse_mode: 'Markdown', disable_web_page_preview: true } as any);
    return true;
  }

  return false; // No se detectó ninguna tool, continuar con el LLM
}

// ── Handler de documentos PDF ─────────────────────────────────────────────────

bot.on('message:document', async (ctx) => {
  const doc = ctx.message.document;
  if (!doc?.mime_type?.includes('pdf')) {
    await ctx.reply('Ese no parece ser un PDF. ¡Mándame el archivo en formato PDF y lo leo! 📄');
    return;
  }

  const tgId = ctx.from?.id;
  if (!tgId) return;

  const user = await quidSync.getUserByTelegram(tgId);
  if (!user) {
    await ctx.reply('Primero debemos vincularnos. Usa /start para obtener tu código.');
    return;
  }

  await ctx.replyWithChatAction('typing');
  await ctx.reply('📖 Leyendo tu PDF... un momento...');

  const file = await ctx.getFile();
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const result = await readPdf(fileUrl);
  await ctx.reply(result, { parse_mode: 'Markdown' });
});

// ── Handler principal de mensajes ──────────────────────────────────────────────
const chatHistory = new Map<number, any[]>();

bot.on('message', async (ctx) => {
  const tgId = ctx.from?.id;
  if (!tgId) return;
  console.log(`[Telegram] Mensaje recibido de ${tgId}`);

  let text = ctx.message.text;
  let isVoice = !!ctx.message.voice;

  // 1. Si es voz, transcribir primero
  if (isVoice && ctx.message.voice) {
    ctx.replyWithChatAction('record_voice');
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    text = await VoiceService.transcribeAudio(fileUrl);
  }

  if (!text) return;

  const user = await quidSync.getUserByTelegram(tgId);
  if (!user) {
    console.log(`[Telegram] Usuario ${tgId} no vinculado`);
    await ctx.reply('Primero debemos vincularnos. Usa /start para obtener tu código.');
    return;
  }
  console.log(`[Telegram] Usuario vinculado: ${user.email || user.id || tgId}`);

  // 2. Intentar despachar una tool directamente (más rápido que el LLM)
  const toolHandled = await tryDispatchTool(ctx, text);
  if (toolHandled) return;

  // 3. Si no hay tool, usar el nuevo "Cerebro Central" en Quid App
  await ctx.replyWithChatAction(isVoice ? 'record_voice' : 'typing');
  const thinkingMessage = await ctx.reply('Te escucho. Dame un momento mientras reviso Quid.');
  
  // Mantenemos un historial básico en memoria por usuario (máximo 10 mensajes para no saturar)
  let history = chatHistory.get(tgId) || [];
  history.push({ role: 'user', content: text });

  let responseText = '';
  try {
    const apiHost = process.env.QUID_API_URL ? new URL(process.env.QUID_API_URL).origin : 'http://quid-app:3000';
    console.log(`[Quid Aura Engine] Enviando mensaje de ${tgId} a ${apiHost}/api/aura/chat`);
    const res = await fetch(`${apiHost}/api/aura/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-aura-token': process.env.AURA_API_KEY || '',
      },
      body: JSON.stringify({
        telegramId: tgId,
        messages: history
      })
    });
    
    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`[Quid Aura Engine] HTTP ${res.status}: ${errorBody}`);
      if (res.status === 404) {
        throw new Error('Tu Telegram todavía no está vinculado con Quid. Usa /start para generar un código.');
      }
      if (res.status >= 500) {
        throw new Error('Quid está activo, pero Aura no pudo procesar la solicitud. Revisa Ollama y el modelo configurado.');
      }
      throw new Error('Quid rechazó la solicitud de Aura.');
    }
    const data = await res.json();
    responseText = data.text;
    console.log(`[Quid Aura Engine] Respuesta recibida para ${tgId}`);
    
    // Guardamos la respuesta de Aura en el historial
    history.push({ role: 'assistant', content: responseText });
    
    // Limitamos a los últimos 10 mensajes (5 interacciones)
    if (history.length > 10) history = history.slice(-10);
    chatHistory.set(tgId, history);

  } catch (error) {
    console.error('Error conectando con Quid Aura Engine:', error);
    responseText = error instanceof Error
      ? error.message
      : 'No pude conectarme con Quid en este momento. Revisa que la app, Aura y Ollama estén activos.';
    history.pop(); // Revertimos el último mensaje del usuario si falló
  }

  if (!responseText) return;

  // 4. Responder en el mismo formato que recibimos (voz ↔ voz, texto ↔ texto)
  if (isVoice) {
    const audioPath = await VoiceService.textToSpeech(responseText);
    if (audioPath) {
      await ctx.replyWithVoice(new InputFile(audioPath));
      fs.unlinkSync(audioPath);
    } else {
      await ctx.reply(responseText);
    }
  } else {
    await ctx.reply(responseText);
  }

  try {
    await ctx.api.deleteMessage(tgId, thinkingMessage.message_id);
  } catch {
    // Si Telegram no permite borrar el mensaje temporal, no bloqueamos la respuesta.
  }
});

bot.catch((err) => {
  console.error('[Telegram] Error no controlado:', err.error);
});

bot.start();
console.log('🚀 Aura está en línea y lista para la orquesta!');

// ── API de Vinculación con Quid ────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'POST' && req.url === '/verify') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const { code, email } = JSON.parse(body);
        console.log(`📩 Solicitud de vinculación: Código ${code} para ${email}`);

        const success = await PairingService.verifyAndLink(code, email);

        if (success) {
          console.log(`✅ Vinculación exitosa para ${email}`);
          const tgId = PairingService.getLastLinkedId();
          if (tgId) {
            await bot.api.sendMessage(tgId, '¡Listo! Ya somos amiguis 🌸💖 ¿En qué vamos a trabajar hoy?');
          }
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else {
          console.warn(`❌ Vinculación fallida: Código ${code} no encontrado o expirado`);
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Código inválido o expirado' }));
        }
      } catch (e) {
        console.error('🔥 Error procesando vinculación:', e);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Error interno' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

server.listen(3000, '0.0.0.0', () => {
  console.log('📡 Puente Aura-Quid escuchando en el puerto 3000');
});
