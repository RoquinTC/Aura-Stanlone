import axios from 'axios';

export const webSearchDefinition = {
  name: 'web_search',
  description: 'Busca información actualizada en internet. Úsala para preguntas sobre noticias, eventos actuales, precios, o cualquier tema que requiera información reciente.',
  parameters: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'La consulta de búsqueda en español o inglés.'
      }
    },
    required: ['query']
  }
};

export async function webSearch(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return '❌ No tengo acceso a búsqueda web en este momento (TAVILY_API_KEY no configurada).';
  }

  try {
    const response = await axios.post('https://api.tavily.com/search', {
      api_key: apiKey,
      query,
      search_depth: 'basic',
      include_answer: true,
      max_results: 5,
    }, { timeout: 10000 });

    const { answer, results } = response.data;

    let output = '';
    if (answer) {
      output += `📋 *Resumen:* ${answer}\n\n`;
    }

    if (results?.length > 0) {
      output += `🔗 *Fuentes:*\n`;
      results.slice(0, 3).forEach((r: any, i: number) => {
        output += `${i + 1}. [${r.title}](${r.url})\n`;
      });
    }

    return output || '🔍 No encontré resultados relevantes para esa búsqueda.';
  } catch (error: any) {
    console.error('[web_search] Error:', error.response?.data || error.message);
    return '❌ No pude realizar la búsqueda en este momento.';
  }
}
