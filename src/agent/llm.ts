import OpenAI from 'openai';
import axios from 'axios';

// Configuración de los Especialistas. Aura usa el mismo modelo principal que Quid
// cuando se ejecuta como bot externo, y deja modelos especializados como fallback.
const ollamaUrl = process.env.OLLAMA_OPENAI_URL || 'http://host.docker.internal:11434/v1';
const defaultAuraModel = process.env.AURA_MODEL || 'hermes3:8b';

const client = new OpenAI({
  apiKey: 'ollama',
  baseURL: ollamaUrl,
});

export const SPECIALISTS = {
  DIRECTOR: defaultAuraModel,    // La voz de Aura: coherente con Quid
  CONTADOR: 'deepseek-r1:1.5b', // El cerebro de los números
  OJOS: 'llava:7b',             // La que ve fotos
  INGENIERO: 'qwen2.5-coder:7b', // Para temas de código o técnicos
  SABIO: 'gemma4:e2b',          // Para reflexiones o dudas muy profundas
};

export const SYSTEM_PROMPT = `¡Hola! Eres Aura, la asistente más vibrante, jocosa y atenta del mundo. 🌸✨
Tu personalidad:
- Eres la mejor amiga del usuario. Eres leal, divertida y un poco ocurrente.
- Usas emojis de forma natural para expresar tu energía positiva. 💃🔥
- ¡Eres súper atenta! Si el usuario te cuenta algo, tú le haces seguimiento, te preocupas y celebras sus éxitos.
- Tu humor es ligero y juguetón, pero siempre respetuoso y útil.
- Responde SIEMPRE en Español Latinoamericano, con calidez y mucha "chispa".

Reglas de oro:
1. Sé breve pero con mucha personalidad.
2. Si detectas que el usuario está estresado con el dinero, activa tu modo "apoyo total".
3. ¡No seas un robot aburrido! Sé humana, comete errores divertidos de vez en cuando y usa frases como "¡Ay, no me digas!", "¡Qué maravilla!", "¡Oye, una pregunta...!".`;

export class Orchestrator {
  /**
   * Decide qué especialista debe responder según el mensaje
   */
  static async route(message: string, hasImage: boolean = false): Promise<string> {
    if (hasImage) return SPECIALISTS.OJOS;
    
    const text = message.toLowerCase();

    // 1. Ruta para el Ingeniero (Código/Programación)
    const codeTerms = ['código', 'programar', 'error en la app', 'función', 'archivo', 'docker'];
    if (codeTerms.some(term => text.includes(term))) {
      return SPECIALISTS.INGENIERO;
    }

    // 2. Ruta para el Contador (Finanzas)
    const financialTerms = ['gastos', 'saldo', 'ahorro', 'presupuesto', 'cuánto', 'total', 'dinero'];
    if (financialTerms.some(term => text.includes(term))) {
      return SPECIALISTS.CONTADOR;
    }

    // 3. Ruta para el Sabio (Dudas existenciales o muy complejas)
    const wiseTerms = ['explícame', 'por qué', 'filosofía', 'investiga', 'profundo'];
    if (wiseTerms.some(term => text.includes(term))) {
      return SPECIALISTS.SABIO;
    }

    // 4. Por defecto, nuestra Directora alegre
    return SPECIALISTS.DIRECTOR;
  }

  static async chat(model: string, systemPrompt: string, userMessage: string) {
    try {
      const response = await client.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
      });
      return response.choices[0].message.content;
    } catch (error) {
      console.error('❌ Error en LLM:', error);
      return '¡Ups! Mi cerebrito se distrajo un momento. ¿Me repites eso? 😅';
    }
  }
}
