import { actions, video, events, props } from '@podlove/html5-audio-driver';
import { clsx } from 'clsx';
import { padRect, rectContains } from './rect_utils';

interface MediaPlayerEvents {
  durationChange: () => void;
  play: () => void;
  pause: () => void;
  buffering: () => void;
  ready: () => void;
  rate: (rate: number) => void;
  seek: (to: number) => void;
  playtime: (playtime: number) => void;
  videoHeightChange: (height: number) => void;
  showVideo: () => void;
  hideVideo: () => void;
}

type MediaPlayerListernerMap = Partial<{
  [K in keyof MediaPlayerEvents]: MediaPlayerEvents[K][];
}>;

type ListenerTuple<T extends keyof DocumentEventMap> = [
  T,
  (this: Document, e: DocumentEventMap[T]) => void,
];
/**
 * maps `ListenerTuple<'pointerdown' | 'pointerup'>` to `ListenerTuple<'pointerdown'> | ListenerTuple<'pointerup'>`
 */
type DocumentListenerTuples<U extends keyof DocumentEventMap = keyof DocumentEventMap> =
  U extends keyof DocumentEventMap ? ListenerTuple<U> : never;

/**
 * Media player with support for video preview and scrubbing. Keeps playtime when changing sources.
 *
 * call `init()` before using any other function and don't forget to `deinit()`
 */
export class MediaPlayer {
  #listeners: MediaPlayerListernerMap = {};
  #scrubbing = false;
  #playing = false;
  #mediaElement!: HTMLMediaElement;
  #mouseListeners: DocumentListenerTuples[] = [];
  #playtime: number = 0;
  #buffering = false;
  #videoVisible = false;
  #videoHeight = 220;

  init() {
    this.#mediaElement = video([]);
    this.#hideVideo();

    const e = events(this.#mediaElement);
    e.onPlay(() => {
      if (this.#scrubbing) {
        // prevent interfering with scrubbing via media keys etc.
        actions(this.#mediaElement).pause();
        return;
      }

      if (!this.#playing) {
        this.#playing = true;
        this.#emit('play');
      }
    });
    e.onPause(() => {
      // hide the internal pausing for scrubbing
      if (this.#scrubbing) {
        return;
      }

      if (this.#playing) {
        this.#playing = false;
        this.#emit('pause');
      }
    });
    e.onPlaytimeUpdate((t) => {
      if (t != undefined && this.#canTrustPlaytime()) {
        this.#playtime = t;
        this.#emit('playtime', t);
      }
    });

    e.onReady(() => {
      // restore playtime after source changed
      if (props(this.#mediaElement).playtime == 0) {
        actions(this.#mediaElement).setPlaytime(this.#playtime);
        if (this.#playing) {
          this.play();
        }
      }

      this.#buffering = false;
      this.#emit('ready');
    });
    e.onBuffering(() => {
      this.#buffering = true;
      this.#emit('buffering');
    });
    e.onDurationChange(() => this.#emit('durationChange'));
  }

  deinit() {
    this.#hideVideo(); // also cleans up global listeners
    this.#mediaElement.pause();
    this.#mediaElement.innerHTML = '';
    this.#mediaElement.remove();
  }

  #canTrustPlaytime() {
    return props(this.#mediaElement).buffered.length > 0;
  }

  #emit<K extends keyof MediaPlayerEvents>(event: K, ...payload: Parameters<MediaPlayerEvents[K]>) {
    if (!this.#listeners[event]) return;
    this.#listeners[event].forEach((l) => {
      // should work without any in my opinion, but it does not :(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      l(...(payload as [any]));
    });
  }

  addListener<K extends keyof MediaPlayerEvents>(event: K, handler: MediaPlayerEvents[K]) {
    if (!this.#listeners[event]) {
      this.#listeners[event] = [];
    }
    this.#listeners[event].push(handler);
  }

  removeListener<K extends keyof MediaPlayerEvents>(event: K, handler: MediaPlayerEvents[K]) {
    if (!this.#listeners[event]) return;

    const listeners = this.#listeners[event];
    const newListeners = listeners.filter((h) => h !== handler) as typeof listeners;
    this.#listeners[event] = newListeners;
  }

  play() {
    if (!this.#playing) {
      this.#playing = true;
      this.#emit('play');
    }

    if (!this.#scrubbing) {
      actions(this.#mediaElement).play();
    }
  }

  pause() {
    if (this.#playing) {
      this.#playing = false;
      this.#emit('pause');
    }

    if (!this.#scrubbing) {
      actions(this.#mediaElement).pause();
    }
  }

  startScrub(to: number) {
    to = Math.max(0, to);
    if (!this.#scrubbing) {
      this.#scrubbing = true;
      actions(this.#mediaElement).pause();
    }

    this.#playtime = to;
    actions(this.#mediaElement).setPlaytime(to);
  }

  endScrub() {
    this.#scrubbing = false;

    if (this.#playing) {
      actions(this.#mediaElement).play();
    }
  }

  seek(to: number) {
    to = Math.max(0, to);
    this.#playtime = to;
    actions(this.#mediaElement).setPlaytime(to);
    this.#emit('seek', to);
  }

  seekRelative(sec: number) {
    this.seek(this.playtime + sec);
  }

  get isPlaying() {
    return this.#playing;
  }

  get isScrubbing() {
    return this.#scrubbing;
  }

  get playtime() {
    return this.#canTrustPlaytime() ? this.#mediaElement.currentTime : this.#playtime;
  }

  get playbackRate() {
    return props(this.#mediaElement).rate || 1;
  }

  set playbackRate(rate: number) {
    actions(this.#mediaElement).setRate(rate);
  }

  get isBuffering() {
    return this.#buffering;
  }

  get duration() {
    return props(this.#mediaElement).duration;
  }

  get videoHeight() {
    return this.#videoHeight;
  }

  set videoHeight(height: number) {
    this.#videoHeight = height;
    if (this.#videoVisible) {
      this.#mediaElement.style.height = height + 'px';
    }
    this.#emit('videoHeightChange', height);
  }

  get videoVisible() {
    return this.#videoVisible;
  }

  set videoVisible(visible: boolean) {
    if (visible) {
      this.#showVideo();
    } else {
      this.#hideVideo();
    }
  }

  load(sources: { src: string; type: string }[]) {
    // update playtime right before unloading to prevent cursor jumping
    const playtime = this.#mediaElement?.currentTime;
    if (playtime !== undefined && playtime !== 0) {
      this.#playtime = playtime;
    }

    this.#mediaElement.innerHTML = '';
    sources.forEach((source) => {
      const sourceElement = document.createElement('source');
      sourceElement.src = source.src;
      sourceElement.type = source.type;
      this.#mediaElement.appendChild(sourceElement);
    });
    this.#mediaElement.load();
    if (this.#playing) {
      actions(this.#mediaElement).play();
    }
  }

  #hideVideo() {
    if (this.#videoVisible) {
      this.#videoVisible = false;
      this.#emit('hideVideo');
    }

    this.#mediaElement.className = 'hidden';

    this.#mouseListeners.forEach((l) => {
      document.removeEventListener(l[0], l[1] as (ev: DocumentEventMap[(typeof l)[0]]) => void);
    });
    this.#mouseListeners = [];
  }

  #showVideo() {
    if (!this.#videoVisible) {
      this.#videoVisible = true;
      this.#emit('showVideo');
    }

    this.#mediaElement.className = clsx(
      'fixed',
      'right-6',
      'bottom-[190px]',
      'bg-black',
      'border-black dark:border-neutral-200',
      'border-2',
      'shadow-brutal',
      'shadow-slate-400 dark:shadow-neutral-600',
      'rounded-lg',
      'max-h-[calc(100vh-10rem)]',
      'max-w-[calc(100vw-3rem)]',
      'z-20',
    );
    this.#mediaElement.style.height = this.#videoHeight + 'px';

    const getCursorType = (e: MouseEvent) => {
      const videoRect = this.#mediaElement.getBoundingClientRect();
      const paddedRect = padRect(videoRect, 10);
      if (!rectContains(paddedRect, { x: e.clientX, y: e.clientY })) {
        return 'initial';
      }

      const isLeftEdge = Math.abs(e.clientX - videoRect.x) < 10;
      const isTopEdge = Math.abs(e.clientY - videoRect.y) < 10;
      if (isLeftEdge && isTopEdge) {
        return 'nw-resize';
      } else if (isLeftEdge) {
        return 'w-resize';
      } else if (isTopEdge) {
        return 'n-resize';
      } else {
        return 'initial';
      }
    };

    let draggingStart: null | {
      x: number;
      y: number;
      initialWidth: number;
      initialHeight: number;
      cursorType: 'nw-resize' | 'w-resize' | 'n-resize' | 'initial';
    } = null;
    const onPointerDown = (e: MouseEvent) => {
      const videoRect = this.#mediaElement.getBoundingClientRect();
      const cursorType = getCursorType(e);
      if (cursorType != 'initial') {
        draggingStart = {
          x: e.clientX,
          y: e.clientY,
          initialWidth: videoRect.width,
          initialHeight: videoRect.height,
          cursorType,
        };
        e.stopPropagation();
        e.preventDefault();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    this.#mouseListeners.push(['pointerdown', onPointerDown]);

    const onPointerUp = () => {
      draggingStart = null;
    };
    document.addEventListener('pointerup', onPointerUp);
    this.#mouseListeners.push(['pointerup', onPointerUp]);

    const onPointerMove = (e: MouseEvent) => {
      if (draggingStart) {
        let isWidth = draggingStart.cursorType == 'w-resize';
        const targetAspect = draggingStart.initialWidth / draggingStart.initialHeight;
        const width = draggingStart.initialWidth + draggingStart.x - e.clientX;
        const height = draggingStart.initialHeight + draggingStart.y - e.clientY;
        if (draggingStart.cursorType === 'nw-resize') {
          const newAspect = width / height;
          isWidth = targetAspect > newAspect;
        }
        const setHeight = isWidth ? width / targetAspect : height;
        const maxHeight = (window.innerWidth - 50) / targetAspect;
        const realHeight = Math.max(Math.min(setHeight, maxHeight), 50);
        this.#mediaElement.style.height = `${realHeight}px`;
        this.#videoHeight = realHeight;
        this.#emit('videoHeightChange', realHeight);

        document.documentElement.style.cursor = draggingStart.cursorType;
      } else {
        document.documentElement.style.cursor = getCursorType(e);
      }
    };
    document.addEventListener('pointermove', onPointerMove);
    this.#mouseListeners.push(['pointermove', onPointerMove]);
  }
}
