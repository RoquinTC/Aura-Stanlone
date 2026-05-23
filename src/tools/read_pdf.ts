import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const readPdfDefinition = {
  name: 'read_pdf',
  description: 'Extrae y lee el texto de un archivo PDF enviado por el usuario en Telegram.',
  parameters: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'URL del archivo PDF (puede ser una URL de Telegram api.telegram.org o cualquier URL pública).'
      }
    },
    required: ['url']
  }
};

export async function readPdf(rawUrl: string): Promise<string> {
  // Extraer solo la URL por si el LLM envía texto extra
  const urlMatch = rawUrl.match(/https?:\/\/[^\s]+/);
  const url = urlMatch ? urlMatch[0] : rawUrl.trim();

  if (url.includes('drive.google.com')) {
    return '❌ No puedo leer enlaces de Google Drive directamente. Por favor, descarga el PDF y envíamelo directamente por Telegram.';
  }

  const tempPath = path.join(os.tmpdir(), `pdf_${Date.now()}.pdf`);

  try {
    // Descargar el PDF
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
    });

    fs.writeFileSync(tempPath, response.data);

    // Importación dinámica para evitar problemas con ESM
    const { default: pdfParse } = await import('pdf-parse');
    const buffer = fs.readFileSync(tempPath);
    const data = await pdfParse(buffer);

    const text = data.text.trim().substring(0, 6000);
    const pages = data.numpages;

    return `📄 *PDF leído exitosamente* (${pages} página${pages !== 1 ? 's' : ''})\n\n${text}${data.text.length > 6000 ? '\n\n_[Texto truncado a 6000 caracteres]_' : ''}`;
  } catch (error: any) {
    console.error('[read_pdf] Error:', error.message);
    return '❌ No pude leer el PDF. Verifica que el archivo sea accesible y esté en formato PDF válido.';
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}
