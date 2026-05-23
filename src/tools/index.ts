// Barrel export de todas las tools disponibles para Aura
export { createImageDefinition, createImageHandler } from './create_image.js';
export { getCryptoPriceDefinition, getCryptoPrice } from './get_crypto_price.js';
export { webSearchDefinition, webSearch } from './web_search.js';
export { readPdfDefinition, readPdf } from './read_pdf.js';

// Definiciones agrupadas para pasarlas al LLM como "tools available"
import { createImageDefinition } from './create_image.js';
import { getCryptoPriceDefinition } from './get_crypto_price.js';
import { webSearchDefinition } from './web_search.js';
import { readPdfDefinition } from './read_pdf.js';

export const ALL_TOOL_DEFINITIONS = [
  createImageDefinition,
  getCryptoPriceDefinition,
  webSearchDefinition,
  readPdfDefinition,
];
