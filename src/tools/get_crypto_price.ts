import axios from 'axios';

export const getCryptoPriceDefinition = {
  name: 'get_crypto_price',
  description: 'Obtiene el precio actual de Bitcoin (y otras criptomonedas populares) en USD desde CoinGecko.',
  parameters: {
    type: 'object' as const,
    properties: {
      coin: {
        type: 'string',
        description: 'ID de la criptomoneda en CoinGecko (ej: bitcoin, ethereum, solana). Por defecto bitcoin.',
        enum: ['bitcoin', 'ethereum', 'solana', 'ripple', 'dogecoin', 'cardano']
      }
    },
    required: []
  }
};

export async function getCryptoPrice(coin: string = 'bitcoin'): Promise<string> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd,cop`;

  try {
    const response = await axios.get(url, { timeout: 5000 });
    const data = response.data[coin];
    if (!data) return `❌ No encontré el precio de "${coin}".`;

    const usd = data.usd?.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) ?? 'N/A';
    const cop = data.cop?.toLocaleString('es-CO', { style: 'currency', currency: 'COP' }) ?? 'N/A';

    const emoji: Record<string, string> = {
      bitcoin: '₿', ethereum: '⟠', solana: '◎', ripple: '✕', dogecoin: '🐕', cardano: '₳'
    };

    return `${emoji[coin] ?? '💰'} *${coin.charAt(0).toUpperCase() + coin.slice(1)}*\n\n• USD: ${usd}\n• COP: ${cop}\n\n_Fuente: CoinGecko • ${new Date().toLocaleTimeString('es-CO')}_`;
  } catch (error: any) {
    console.error('[get_crypto_price] Error:', error.message);
    return '❌ No pude obtener el precio en este momento. Intenta de nuevo en un momento.';
  }
}
