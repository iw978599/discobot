/**
 * Singleton AudioContext manager to prevent multiple instances
 * and memory leaks
 */

import { AUDIO_CONTEXT } from './constants';

class AudioContextManager {
  private static instance: AudioContextManager;
  private audioContext: AudioContext | null = null;
  private contextCount = 0;

  private constructor() {}

  public static getInstance(): AudioContextManager {
    if (!AudioContextManager.instance) {
      AudioContextManager.instance = new AudioContextManager();
    }
    return AudioContextManager.instance;
  }

  /**
   * Gets or creates the shared AudioContext
   * Ensures only one AudioContext exists across the application
   */
  public getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({
        sampleRate: AUDIO_CONTEXT.DEFAULT_SAMPLE_RATE,
      });
      this.contextCount++;

      console.log(`AudioContext created (count: ${this.contextCount})`);

      if (this.contextCount > 1) {
        console.warn(
          `Warning: Multiple AudioContext instances created (${this.contextCount}). ` +
          'This may cause memory issues. Max browser limit is typically 6.'
        );
      }
    }

    // Resume context if suspended (e.g., after user interaction)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch((error) => {
        console.error('Failed to resume AudioContext:', error);
      });
    }

    return this.audioContext;
  }

  /**
   * Closes the AudioContext and releases resources
   * Should be called when the application is shutting down
   */
  public async dispose(): Promise<void> {
    if (this.audioContext) {
      try {
        await this.audioContext.close();
        console.log('AudioContext closed successfully');
      } catch (error) {
        console.error('Error closing AudioContext:', error);
      } finally {
        this.audioContext = null;
      }
    }
  }

  /**
   * Gets the current state of the AudioContext
   */
  public getState(): AudioContextState | null {
    return this.audioContext?.state ?? null;
  }

  /**
   * Creates an offline context for rendering audio
   */
  public createOfflineContext(
    numberOfChannels: number,
    length: number,
    sampleRate: number = AUDIO_CONTEXT.RENDER_SAMPLE_RATE
  ): OfflineAudioContext {
    return new OfflineAudioContext(numberOfChannels, length, sampleRate);
  }
}

// Export singleton instance
// Note: AudioContext is created lazily on first getContext() call
// This prevents crashes in Node.js server environment where AudioContext doesn't exist
export const audioContextManager = AudioContextManager.getInstance();
