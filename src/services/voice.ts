import fs from 'fs';
import path from 'path';
import axios from 'axios';
import OpenAI from 'openai';
import { EdgeTTS } from 'node-edge-tts';
import os from 'os';

const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const TEMP_DIR = os.tmpdir();

export class VoiceService {
  /**
   * Transcribe un archivo de audio usando Whisper en Groq.
   */
  static async transcribeAudio(fileUrl: string): Promise<string> {
    const tempFilePath = path.join(TEMP_DIR, `in_${Date.now()}.ogg`);

    try {
      const response = await axios({
        method: 'GET',
        url: fileUrl,
        responseType: 'arraybuffer',
      });

      fs.writeFileSync(tempFilePath, response.data);

      const transcription = await groqClient.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-large-v3-turbo',
        language: 'es',
      });

      return transcription.text;
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }

  /**
   * Convierte texto a voz usando Microsoft Edge TTS.
   */
  static async textToSpeech(text: string): Promise<string | null> {
    const tempFilePath = path.join(TEMP_DIR, `out_${Date.now()}.mp3`);

    try {
      const tts = new EdgeTTS({
        voice: 'es-MX-DaliaNeural',
        rate: '+30%'
      });
      await tts.ttsPromise(text, tempFilePath);
      return tempFilePath;
    } catch (error: any) {
      console.error("Error al generar TTS:", error.message);
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      return null;
    }
  }
}
