import { AudioClip, AudioSource } from 'cc';
import {
    AUDIO_BGM_VOLUME,
    AUDIO_SFX_VOLUME,
    AUDIO_SIEGE_FAIL_VOLUME,
    AUDIO_WALK_VOLUME,
} from '../config/GameConfig';

export interface AudioClips {
    bgm: AudioClip | null;
    walk: AudioClip | null;
    battle: AudioClip | null;
    /** 单次攻城成功。 */
    siegeSucc: AudioClip | null;
    /** 单次攻城失败。 */
    siegeFail: AudioClip | null;
    /** 整局胜利。 */
    succ: AudioClip | null;
    /** 整局失败。 */
    fail: AudioClip | null;
}

/**
 * 统一播放 BGM 和音效。
 * 总开关关闭时不播放；暂停时静音，恢复后再按开关决定是否继续。
 * 音量在 GameConfig 的 AUDIO_*_VOLUME 里调。
 */
export class AudioView {
    private readonly bgmSource: AudioSource | null;
    private readonly sfxSource: AudioSource | null;
    private readonly clips: AudioClips;
    private enabled = true;
    private mutedByPause = false;
    private loopKind: 'walk' | 'battle' | null = null;

    constructor(bgmSource: AudioSource | null, sfxSource: AudioSource | null, clips: AudioClips) {
        this.bgmSource = bgmSource;
        this.sfxSource = sfxSource;
        this.clips = clips;
        if (this.bgmSource) {
            this.bgmSource.loop = true;
            this.bgmSource.playOnAwake = false;
            this.bgmSource.volume = AUDIO_BGM_VOLUME;
        }
        if (this.sfxSource) {
            this.sfxSource.playOnAwake = false;
            this.sfxSource.volume = AUDIO_SFX_VOLUME;
        }
    }

    setEnabled(on: boolean): void {
        this.enabled = on;
        if (!on) {
            this.stopAll();
            return;
        }
        if (!this.mutedByPause) {
            this.playBgm();
            this.resumeLoop();
        }
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    playBgm(): void {
        if (!this.canPlay() || !this.bgmSource || !this.clips.bgm) {
            return;
        }
        if (this.bgmSource.clip !== this.clips.bgm) {
            this.bgmSource.clip = this.clips.bgm;
        }
        this.bgmSource.loop = true;
        this.bgmSource.volume = AUDIO_BGM_VOLUME;
        if (!this.bgmSource.playing) {
            this.bgmSource.play();
        }
    }

    stopBgm(): void {
        this.bgmSource?.stop();
    }

    playWalk(): void {
        this.playLoop('walk', this.clips.walk);
    }

    stopWalk(): void {
        if (this.loopKind === 'walk') {
            this.stopSfx();
            this.loopKind = null;
        }
    }

    playBattle(): void {
        this.playLoop('battle', this.clips.battle);
    }

    stopBattle(): void {
        if (this.loopKind === 'battle') {
            this.stopSfx();
            this.loopKind = null;
        }
    }

    /** 单次攻城成功。不停 BGM。 */
    playSiegeSucc(): void {
        this.stopSfx();
        this.loopKind = null;
        this.playOneShot(this.clips.siegeSucc);
    }

    /** 单次攻城失败。不停 BGM。 */
    playSiegeFail(): void {
        this.stopSfx();
        this.loopKind = null;
        this.playOneShot(this.clips.siegeFail, AUDIO_SIEGE_FAIL_VOLUME);
    }

    playSucc(): void {
        this.stopBgm();
        this.stopSfx();
        this.loopKind = null;
        this.playOneShot(this.clips.succ);
    }

    playFail(): void {
        this.stopBgm();
        this.stopSfx();
        this.loopKind = null;
        this.playOneShot(this.clips.fail);
    }

    /** 暂停游戏时静音全部声音。 */
    muteForPause(): void {
        this.mutedByPause = true;
        this.bgmSource?.pause();
        this.sfxSource?.pause();
    }

    /** 继续游戏时按开关恢复。 */
    unmuteAfterPause(): void {
        this.mutedByPause = false;
        if (!this.enabled) {
            return;
        }
        this.playBgm();
        this.resumeLoop();
    }

    stopAll(): void {
        this.stopBgm();
        this.stopSfx();
    }

    private playLoop(kind: 'walk' | 'battle', clip: AudioClip | null): void {
        if (!this.canPlay() || !this.sfxSource || !clip) {
            this.loopKind = kind;
            return;
        }
        this.loopKind = kind;
        this.sfxSource.stop();
        this.sfxSource.clip = clip;
        this.sfxSource.loop = true;
        this.sfxSource.volume = kind === 'walk' ? AUDIO_WALK_VOLUME : AUDIO_SFX_VOLUME;
        this.sfxSource.play();
    }

    private resumeLoop(): void {
        if (this.loopKind === 'walk') {
            this.playLoop('walk', this.clips.walk);
            return;
        }
        if (this.loopKind === 'battle') {
            this.playLoop('battle', this.clips.battle);
        }
    }

    private playOneShot(clip: AudioClip | null, volume: number = AUDIO_SFX_VOLUME): void {
        if (!this.canPlay() || !this.sfxSource || !clip) {
            return;
        }
        this.sfxSource.loop = false;
        this.sfxSource.clip = clip;
        this.sfxSource.volume = volume;
        this.sfxSource.play();
    }

    private stopSfx(): void {
        this.sfxSource?.stop();
    }

    private canPlay(): boolean {
        return this.enabled && !this.mutedByPause;
    }
}
