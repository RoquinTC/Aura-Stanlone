import { quidSync } from '../services/quid-sync.js';

interface PendingPair {
  code: string;
  telegramId: number;
  expiresAt: number;
}

export class PairingService {
  private static pendingPairs: Map<number, PendingPair> = new Map();
  private static lastLinkedId: number | null = null;

  /**
   * Genera un código de 6 dígitos para un nuevo usuario de Telegram
   */
  static generateCode(telegramId: number): string {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.pendingPairs.set(telegramId, {
      code,
      telegramId,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutos de vida
    });
    console.log(`🔑 Código generado: ${code} para Telegram ID: ${telegramId}`);
    return code;
  }

  /**
   * Verifica si un código es válido (esto lo llamaremos desde la App de Quid)
   */
  static async verifyAndLink(code: string, userEmail: string): Promise<boolean> {
    console.log(`🔎 Verificando código: ${code} (Pendientes: ${this.pendingPairs.size})`);
    
    for (const [tgId, pair] of this.pendingPairs.entries()) {
      if (pair.code === code) {
        if (pair.expiresAt > Date.now()) {
          const success = await quidSync.linkTelegram(userEmail, tgId);
          if (success) {
            this.lastLinkedId = tgId;
            this.pendingPairs.delete(tgId);
            return true;
          }
        } else {
          console.warn(`⏰ El código ${code} ha expirado.`);
        }
      }
    }
    return false;
  }

  static getLastLinkedId(): number | null {
    const id = this.lastLinkedId;
    this.lastLinkedId = null; // Limpiamos para no repetir
    return id;
  }
}
