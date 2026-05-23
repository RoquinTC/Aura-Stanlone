import { Context } from 'grammy';

export const createImageDefinition = {
  name: 'create_image',
  description: 'Genera una imagen artística de alta calidad a partir de una descripción.',
  parameters: {
    type: 'object' as const,
    properties: {
      prompt: { type: 'string', description: 'Descripción de la imagen en español.' },
      english_prompt: { type: 'string', description: 'Descripción de la imagen en inglés para el generador.' }
    },
    required: ['prompt', 'english_prompt']
  }
};

export async function createImageHandler(ctx: Context, args: { prompt: string; english_prompt: string }) {
  const { prompt, english_prompt } = args;
  const seed = Math.floor(Math.random() * 1000000);

  // Pollinations.ai — 100% gratuito, sin API key
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(english_prompt)}?width=1024&height=1024&seed=${seed}&nologo=true`;

  try {
    await ctx.replyWithChatAction('upload_photo');
    await ctx.replyWithPhoto(imageUrl, {
      caption: `🎨 *Imagen Generada*\n\n📝 *Idea:* ${prompt}`,
      parse_mode: 'Markdown'
    });
    return 'Imagen enviada con éxito.';
  } catch (error: any) {
    console.error('[create_image] Error:', error.message);
    await ctx.reply('❌ No pude generar la imagen en este momento. ¿Lo intentamos de otra forma?');
    return `Error: ${error.message}`;
  }
}
