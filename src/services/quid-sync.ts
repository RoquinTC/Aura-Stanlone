import axios from 'axios';

const QUID_API_URL = process.env.QUID_API_URL || 'https://quid.roquintc.app/api/aura/sync';
const AURA_API_KEY = process.env.AURA_API_KEY;

export class QuidSyncService {
  /**
   * Obtiene datos financieros del usuario desde la App de Quid
   */
  async getFinancialData(email: string) {
    try {
      const response = await axios.get(QUID_API_URL, {
        params: { email },
        headers: { 'x-aura-token': AURA_API_KEY }
      });
      return response.data;
    } catch (error) {
      console.error('❌ Error sincronizando con Quid:', error);
      return null;
    }
  }

  /**
   * Busca un usuario por su ID de Telegram
   */
  async getUserByTelegram(telegramId: number) {
    try {
      const response = await axios.get(`${QUID_API_URL}/user`, {
        params: { telegramId },
        headers: { 'x-aura-token': AURA_API_KEY }
      });
      return response.data;
    } catch (error) {
      // Si no existe, es normal (usuario nuevo)
      return null;
    }
  }

  /**
   * Vincula una cuenta de Telegram con un email de Quid
   */
  async linkTelegram(email: string, telegramId: number) {
    try {
      await axios.post(`${QUID_API_URL}/link`, {
        email,
        telegramId
      }, {
        headers: { 'x-aura-token': AURA_API_KEY }
      });
      return true;
    } catch (error) {
      console.error('❌ Error vinculando Telegram:', error);
      return false;
    }
  }
}

export const quidSync = new QuidSyncService();
