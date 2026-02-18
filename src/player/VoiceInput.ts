import { GameEventType } from '../shared/types';
import { EventBus } from '../engine/EventBus';

// ============================================================
// VoiceInput - Web Speech API integration for voice commands
// Uses push-to-talk (V key) to capture speech and emit it
// as a PLAYER_COMMAND event for downstream processing.
// ============================================================

// Web Speech API type declarations for environments that lack them
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare const webkitSpeechRecognition: { new (): SpeechRecognitionInstance } | undefined;

export class VoiceInput {
  private readonly eventBus: EventBus;
  private recognition: SpeechRecognitionInstance | null = null;
  private _isListening = false;
  private voiceIndicator: HTMLElement | null = null;

  // Bound references for cleanup
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.voiceIndicator = document.getElementById('voice-indicator');

    this.initRecognition();

    this.onKeyDown = this.handleKeyDown.bind(this);
    this.onKeyUp = this.handleKeyUp.bind(this);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  // ---- Initialization ----

  private initRecognition(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (typeof webkitSpeechRecognition !== 'undefined' ? webkitSpeechRecognition : undefined);

    if (!SpeechRecognitionCtor) {
      console.warn('Speech recognition not supported');
      return;
    }

    this.recognition = new SpeechRecognitionCtor() as SpeechRecognitionInstance;
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[event.resultIndex];
      if (result && result[0]) {
        const transcript = result[0].transcript.trim();
        if (transcript.length > 0) {
          this.eventBus.emit(GameEventType.PLAYER_COMMAND, {
            transcript,
            timestamp: Date.now(),
          });
        }
      }
    };

    this.recognition.onend = () => {
      // Update indicator when recognition ends naturally
      if (!this._isListening) {
        this.updateIndicator(false);
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "no-speech" and "aborted" are expected during normal push-to-talk usage
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.error(`Speech recognition error: ${event.error}`);
      }
      this.updateIndicator(false);
    };
  }

  // ---- Event handlers ----

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'v' && e.key !== 'V') return;
    if (e.repeat) return; // ignore key-repeat

    // Don't capture if user is typing in an input field
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    this.startListening();
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (e.key !== 'v' && e.key !== 'V') return;
    this.stopListening();
  }

  // ---- Public methods ----

  /**
   * Begin speech recognition. Shows the voice indicator.
   */
  startListening(): void {
    if (!this.recognition) return;
    if (this._isListening) return;

    try {
      this.recognition.start();
      this._isListening = true;
      this.updateIndicator(true);
    } catch (err) {
      // start() throws if already started
      console.warn('Could not start speech recognition:', err);
    }
  }

  /**
   * Stop speech recognition. Hides the voice indicator.
   */
  stopListening(): void {
    if (!this.recognition) return;
    if (!this._isListening) return;

    try {
      this.recognition.stop();
    } catch {
      // stop() may throw if not started
    }
    this._isListening = false;
    this.updateIndicator(false);
  }

  /**
   * Toggle listening on/off. Used for click-to-talk UI.
   */
  toggleListening(): void {
    if (this._isListening) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  /**
   * Whether the voice recognition is currently active.
   */
  get isListening(): boolean {
    return this._isListening;
  }

  /**
   * Remove all event listeners and stop recognition.
   */
  destroy(): void {
    this.stopListening();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  // ---- Private helpers ----

  private updateIndicator(active: boolean): void {
    if (this.voiceIndicator) {
      this.voiceIndicator.style.display = active ? 'block' : 'none';
    }
  }
}
