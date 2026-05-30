import { Bot, Context, InlineKeyboard } from 'grammy';
import { PairingService } from './agent/pairing.js';
import { quidSync } from './services/quid-sync.js';
import { VoiceService } from './services/voice.ts';
import { createImageHandler, getCryptoPrice, webSearch, readPdf } from './tools/index.js';
import http from 'http';
import { InputFile } from 'grammy';
import fs from 'fs';

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

function getQuidAppUrl(path = '') {
  const configuredUrl = process.env.QUID_APP_URL || 'https://quid.roquintc.app';
  return `${configuredUrl.replace(/\/$/, '')}${path}`;
}

function addQuidNavigationButton(keyboard: InlineKeyboard | undefined, text: string, responseText: string) {
  const normalized = `${text} ${responseText}`.toLowerCase();
  const target =
    /\b(lista|listas|mercado|compras?)\b/.test(normalized)
      ? { label: '🛒 Ver listas de mercado', path: '/?module=pantry&view=shopping-lists' }
      : /\b(cita|citas|m[eé]dic[oa]|doctor|eps)\b/.test(normalized)
        ? { label: '🩺 Ver citas médicas', path: '/?module=health&view=appointments' }
        : /\b(deuda|deudas|cr[eé]dito|tarjeta)\b/.test(normalized)
          ? { label: '💳 Ver deudas', path: '/?module=finance&view=debts' }
          : /\b(pago|pagos|vencimiento|recurrente)\b/.test(normalized)
            ? { label: '📅 Ver pagos', path: '/?module=finance&view=recurring' }
            : /\b(cuenta|cuentas|saldo|balance|finanzas?)\b/.test(normalized)
              ? { label: '📊 Ver finanzas', path: '/?module=finance&view=overview' }
              : null;

  if (!target) return keyboard;

  if (keyboard) {
    return keyboard.row().url(target.label, getQuidAppUrl(target.path));
  }

  return new InlineKeyboard().url(target.label, getQuidAppUrl(target.path));
}

const CATEGORY_MAP: Record<string, string[]> = {
  'Alimentación': ['Supermercado', 'Restaurantes', 'Comida rápida', 'Cafetería'],
  'Transporte': ['Combustible', 'Pasajes / Uber', 'Peajes', 'Mantenimiento'],
  'Servicios': ['Celular / Internet', 'Luz / Agua / Gas', 'Suscripciones'],
  'Salud': ['Medicamentos', 'Citas médicas', 'Seguro / EPS'],
  'Entretenimiento': ['Cine / Salidas', 'Rumba / Bar', 'Eventos'],
  'Educación': ['Cursos', 'Matrícula', 'Libros / Papelería'],
  'Ropa': ['Ropa', 'Zapatos', 'Accesorios'],
  'Deudas': ['Tarjetas de crédito', 'Préstamos'],
  'Otros': ['Papelería', 'Imprevistos', 'Regalos']
};

async function fetchUserCategories(tgId: number): Promise<Record<string, string[]>> {
  try {
    const apiHost = process.env.QUID_API_URL ? new URL(process.env.QUID_API_URL).origin : 'http://quid-app:3000';
    console.log(`[Aura Standalone] Fetching custom categories for Telegram ID: ${tgId} from ${apiHost}`);
    const res = await fetch(`${apiHost}/api/aura/categories?telegramId=${tgId}`, {
      headers: {
        'x-aura-token': process.env.AURA_API_KEY || '',
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch categories: ${res.statusText}`);
    }
    const data = await res.json();
    if (data.success && data.categories) {
      return data.categories;
    }
  } catch (error) {
    console.error('Error fetching categories from Quid App:', error);
  }
  return CATEGORY_MAP;
}

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
  const normalized = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Cualquier intento de consultar o registrar datos de Quid debe ir primero
  // al motor central, no a herramientas externas como cripto o web.
  const quidIntent = /\b(gaste|gasté|gasto|gastado|pague|pagué|compre|compré|ingreso|recibi|recibí|transferi|transferí|saldo|cuanto tengo|cuánto tengo|meta|ahorro|cdt|recurrente|planner|pendiente|gasolina|tanqueo|combustible)\b/.test(normalized);
  if (quidIntent) return false;

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
  const cryptoPattern = /\b(bitcoin|ethereum|solana|dogecoin|cripto|crypto|btc|eth|sol|doge)\b|precio\s+de\s+(bitcoin|ethereum|solana|dogecoin|btc|eth|sol|doge)/;
  if (cryptoPattern.test(normalized)) {
    await ctx.replyWithChatAction('typing');
    let coin = 'bitcoin';
    if (/\b(ethereum|eth)\b/.test(normalized)) coin = 'ethereum';
    else if (/\b(solana|sol)\b/.test(normalized)) coin = 'solana';
    else if (/\b(dogecoin|doge)\b/.test(normalized)) coin = 'dogecoin';
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

async function processChatMessage(ctx: Context, tgId: number, text: string, isVoice: boolean) {
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
  let replyMarkup = undefined;
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

    // Construcción de botones interactivos si se requiere elegir cuenta/tarjeta
    if (data.action && data.action.type === 'select_account' && Array.isArray(data.action.choices)) {
      const keyboard = new InlineKeyboard();
      data.action.choices.forEach((choice: any, index: number) => {
        const callbackData = `select_account:${choice.name}`.slice(0, 64);
        keyboard.text(choice.name, callbackData);
        if (index % 2 === 1) {
          keyboard.row();
        }
      });
      keyboard.row().text('❌ Cancelar', 'cancel_select_account');
      replyMarkup = keyboard;
    } else if (data.action && data.action.type === 'proposal') {
      const keyboard = new InlineKeyboard()
        .text('✅ Confirmar', 'confirm_proposal')
        .text('✏️ Categoría', 'select_proposal_category')
        .row()
        .text('❌ Cancelar', 'cancel_proposal');
      replyMarkup = keyboard;
    }

    replyMarkup = addQuidNavigationButton(replyMarkup, text, responseText);
    
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
      await ctx.replyWithVoice(new InputFile(audioPath), replyMarkup ? { reply_markup: replyMarkup } : undefined);
      fs.unlinkSync(audioPath);
    } else {
      await ctx.reply(responseText, replyMarkup ? { reply_markup: replyMarkup } : undefined);
    }
  } else {
    await ctx.reply(responseText, replyMarkup ? { reply_markup: replyMarkup } : undefined);
  }

  try {
    await ctx.api.deleteMessage(tgId, thinkingMessage.message_id);
  } catch {
    // Si Telegram no permite borrar el mensaje temporal, no bloqueamos la respuesta.
  }
}

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

  await processChatMessage(ctx, tgId, text, isVoice);
});

// ── Manejadores de Callbacks (Botones) ─────────────────────────────────────────

bot.callbackQuery(/^select_account:(.+)$/, async (ctx) => {
  const accountName = ctx.match[1];
  await ctx.answerCallbackQuery();
  
  // Remover los botones para evitar doble clic
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch (err) {
    console.error('Error al remover el reply markup:', err);
  }

  const tgId = ctx.from?.id;
  if (!tgId) return;

  // Procesar la selección como si el usuario la hubiera escrito
  await processChatMessage(ctx, tgId, accountName, false);
});

bot.callbackQuery('cancel_select_account', async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch (err) {
    console.error('Error al remover el reply markup:', err);
  }
  await ctx.reply('❌ Proceso cancelado. ¿Qué más deseas hacer?');
});

bot.callbackQuery('confirm_proposal', async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch (err) {
    console.error('Error al remover el reply markup:', err);
  }
  const tgId = ctx.from?.id;
  if (!tgId) return;
  await processChatMessage(ctx, tgId, 'confirmar', false);
});

bot.callbackQuery('cancel_proposal', async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch (err) {
    console.error('Error al remover el reply markup:', err);
  }
  const tgId = ctx.from?.id;
  if (!tgId) return;
  await processChatMessage(ctx, tgId, 'cancelar', false);
});

bot.callbackQuery('select_proposal_category', async (ctx) => {
  await ctx.answerCallbackQuery();
  const tgId = ctx.from?.id;
  if (!tgId) return;

  const userCats = await fetchUserCategories(tgId);
  const keyboard = new InlineKeyboard();
  const categories = Object.keys(userCats);
  categories.forEach((cat, index) => {
    keyboard.text(cat, `cat_choice:${cat}`);
    if (index % 2 === 1) keyboard.row();
  });
  keyboard.row().text('⬅️ Volver', 'back_to_proposal');
  
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  } catch (err) {
    console.error('Error editing message reply markup:', err);
  }
});

bot.callbackQuery('back_to_proposal', async (ctx) => {
  await ctx.answerCallbackQuery();
  const keyboard = new InlineKeyboard()
    .text('✅ Confirmar', 'confirm_proposal')
    .text('✏️ Categoría', 'select_proposal_category')
    .row()
    .text('❌ Cancelar', 'cancel_proposal');
    
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  } catch (err) {
    console.error('Error editing message reply markup:', err);
  }
});

bot.callbackQuery(/^cat_choice:(.+)$/, async (ctx) => {
  const categoryName = ctx.match[1];
  await ctx.answerCallbackQuery();
  const tgId = ctx.from?.id;
  if (!tgId) return;
  
  const userCats = await fetchUserCategories(tgId);
  const keyboard = new InlineKeyboard();
  const subs = userCats[categoryName] || [];
  subs.forEach((sub, index) => {
    keyboard.text(sub, `sub_choice:${categoryName}/${sub}`);
    if (index % 2 === 1) keyboard.row();
  });
  keyboard.row().text(`Solo ${categoryName}`, `sub_choice:${categoryName}`);
  keyboard.row().text('⬅️ Volver', 'select_proposal_category');
  
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  } catch (err) {
    console.error('Error editing message reply markup:', err);
  }
});

bot.callbackQuery(/^sub_choice:(.+)$/, async (ctx) => {
  const choice = ctx.match[1]; // "Category/Subcategory" or "Category"
  await ctx.answerCallbackQuery();
  
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch (err) {
    console.error('Error al remover el reply markup:', err);
  }
  
  const tgId = ctx.from?.id;
  if (!tgId) return;

  const formattedChoice = `categoría: ${choice}`;
  await processChatMessage(ctx, tgId, formattedChoice, false);
});

bot.catch((err) => {
  console.error('[Telegram] Error no controlado:', err.error);
});

bot.start();
console.log('🚀 Aura está en línea y lista para la orquesta!');

// ── API de Vinculación con Quid ────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if ((req.method === 'POST' || req.method === 'GET') && req.url?.startsWith('/digest')) {
    const auraToken = req.headers['x-aura-token'];
    if (!process.env.AURA_API_KEY || auraToken !== process.env.AURA_API_KEY) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'No autorizado' }));
      return;
    }

    try {
      const apiHost = process.env.QUID_API_URL ? new URL(process.env.QUID_API_URL).origin : 'http://quid-app:3000';
      const quidResponse = await fetch(`${apiHost}/api/aura/digest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-aura-token': process.env.AURA_API_KEY,
        },
      });

      if (!quidResponse.ok) {
        const errorBody = await quidResponse.text();
        res.writeHead(quidResponse.status);
        res.end(JSON.stringify({ error: errorBody || 'Quid rechazó el digest de Aura' }));
        return;
      }

      const payload = await quidResponse.json() as {
        digests?: Array<{ telegramId?: string | null; message?: string }>;
      };
      let sent = 0;

      for (const digest of payload.digests || []) {
        if (!digest.telegramId || !digest.message) continue;
        await bot.api.sendMessage(Number(digest.telegramId), digest.message);
        sent++;
      }

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, sent }));
    } catch (error) {
      console.error('🔥 Error enviando digest de Aura:', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Error enviando digest de Aura' }));
    }
    return;
  }

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
