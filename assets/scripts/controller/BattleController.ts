import {
    _decorator,
    Animation,
    AudioClip,
    AudioSource,
    Button,
    Component,
    instantiate,
    Label,
    macro,
    Node,
    Prefab,
    profiler,
    ResolutionPolicy,
    Tween,
    UITransform,
    Vec3,
    view,
} from 'cc';
import {
    ATTACKER_FLOAT_OFFSET,
    BATTLE_INTERVAL,
    DEFENDER_FLOAT_OFFSET,
    FACTION_LABEL,
    GameText,
    TROOP_CAP,
} from '../config/GameConfig';
import {
    createSession,
    evaluateEnd,
    findStronghold,
    formatElapsed,
    GameSession,
    getStatusText,
} from '../model/StrongholdState';
import { changeDispatchAmount, onStrongholdClick, tryDispatch, tryRecruit } from '../rules/DispatchRules';
import { applyBattleTick, onArmyArrived } from '../rules/BattleRules';
import { GamePhase, StrongholdId, Vec2 } from '../types/GameTypes';
import { ArmyView, showDamageFloat } from '../view/ArmyView';
import { AudioView } from '../view/AudioView';
import { EndPanelView } from '../view/EndPanelView';
import { HudView } from '../view/HudView';
import { PausePanelView } from '../view/PausePanelView';
import { StrongholdView } from '../view/StrongholdView';

const { ccclass, property } = _decorator;
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;
const HUD_HEIGHT = 150;

interface StrongholdLink {
    id: StrongholdId;
    bodyName: string;
    infoName: string;
}

const STRONGHOLD_LINKS: readonly StrongholdLink[] = [
    { id: 'player_base', bodyName: 'home', infoName: 'HomeInfo' },
    { id: 'neutral_pass', bodyName: 'gold', infoName: 'GoldInfo' },
    { id: 'silver_city', bodyName: 'silver', infoName: 'SilverInfo' },
    { id: 'enemy_fort', bodyName: 'dragon', infoName: 'DragonInfo' },
];

/**
 * 玩法总控。挂在 Canvas 上。
 * 只绑定 game.scene 里的现有节点，不重建背景、城、面板和提示。
 */
@ccclass('BattleController')
export class BattleController extends Component {
    /** 在属性检查器里拖入 ggb.prefab。士兵只从这份预制体生成。 */
    @property(Prefab)
    soldierPrefab: Prefab | null = null;

    /** 在属性检查器里拖入 SiegeFx.prefab。交战时在目标城上方循环播放。 */
    @property(Prefab)
    siegeFxPrefab: Prefab | null = null;

    @property(AudioSource)
    bgmSource: AudioSource | null = null;

    @property(AudioSource)
    sfxSource: AudioSource | null = null;

    @property(AudioClip)
    bgmClip: AudioClip | null = null;

    @property(AudioClip)
    walkClip: AudioClip | null = null;

    @property(AudioClip)
    battleClip: AudioClip | null = null;

    /** 单次攻城成功音效。 */
    @property(AudioClip)
    siegeSuccClip: AudioClip | null = null;

    /** 单次攻城失败音效。 */
    @property(AudioClip)
    siegeFailClip: AudioClip | null = null;

    @property(AudioClip)
    succClip: AudioClip | null = null;

    @property(AudioClip)
    failClip: AudioClip | null = null;

    private session: GameSession = createSession();
    private canvas: Node | null = null;
    private hud: HudView | null = null;
    private endPanel: EndPanelView | null = null;
    private pausePanel: PausePanelView | null = null;
    private audio: AudioView | null = null;
    private timerLabel: Label | null = null;
    private pauseLabel: Label | null = null;
    private pauseButton: Node | null = null;
    private armyView: ArmyView | null = null;
    private siegeFx: Node | null = null;
    private battlePaused = false;
    private readonly strongholdViews = new Map<StrongholdId, StrongholdView>();
    private readonly floatNodes: Node[] = [];
    private resolutionPolicy: number | null = null;
    private initialized = false;

    protected onEnable(): void {
        if (this.initialized) {
            return;
        }
        profiler.hideStats();
        this.canvas = this.node.name === 'Canvas' ? this.node : this.node.scene.getChildByName('Canvas');
        if (!this.canvas) {
            throw new Error('场景缺少 Canvas');
        }
        view.on('canvas-resize', this.handleCanvasResize, this);
        this.applyResolutionPolicy();
        this.session = createSession();
        try {
            this.bindStrongholds();
            this.applySceneFacts();
            this.hud = new HudView(this.requireDescendant(this.canvas, 'Hud'), this.requireDescendant(this.canvas, 'Toast'), {
                onDispatchText: (text) => {
                    this.session.dispatchText = text;
                },
                onMinus: () => this.handleAmountChange(-1),
                onPlus: () => this.handleAmountChange(1),
                onDispatch: () => this.handleDispatch(),
                onRecruit: () => this.handleRecruit(),
                onRestart: () => this.handleRestart(),
            });
            this.bindTimerAndPause();
            this.pausePanel = new PausePanelView(this.requireDescendant(this.canvas, 'PausePanel'), {
                onToggleMusic: () => this.handleToggleMusic(),
                onExit: () => this.handleExitFromPause(),
                onRestart: () => this.handleRestart(),
                onResume: () => this.handleResumeFromPause(),
            });
            this.endPanel = new EndPanelView(this.requireDescendant(this.canvas, 'ClearPanel'), () => this.handleRestart());
            this.audio = new AudioView(this.bgmSource, this.sfxSource, {
                bgm: this.bgmClip,
                walk: this.walkClip,
                battle: this.battleClip,
                siegeSucc: this.siegeSuccClip,
                siegeFail: this.siegeFailClip,
                succ: this.succClip,
                fail: this.failClip,
            });
            this.audio.playBgm();
            this.renderAll();
            this.schedule(this.handleTimerTick, 1, macro.REPEAT_FOREVER, 1);
            this.scheduleOnce(this.refreshResponsiveLayout);
        } catch (error) {
            this.releaseBindings();
            throw error;
        }
        this.initialized = true;
    }

    protected onDisable(): void {
        this.releaseBindings();
    }

    private handleCanvasResize(): void {
        this.applyResolutionPolicy();
        this.scheduleOnce(this.refreshResponsiveLayout);
    }

    /**
     * 宽屏固定高度，窄屏固定宽度。
     * 始终完整显示 1280×720 的设计区域，多出的空间交给背景和 Widget 填充。
     */
    private applyResolutionPolicy(): void {
        const frame = view.getFrameSize();
        if (frame.height <= 0) {
            return;
        }
        const next = frame.width / frame.height >= DESIGN_WIDTH / DESIGN_HEIGHT
            ? ResolutionPolicy.FIXED_HEIGHT
            : ResolutionPolicy.FIXED_WIDTH;
        if (this.resolutionPolicy === next) {
            return;
        }
        this.resolutionPolicy = next;
        view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, next);
    }

    private refreshResponsiveLayout(): void {
        if (!this.canvas) {
            return;
        }
        const canvasTransform = this.canvas.getComponent(UITransform);
        if (!canvasTransform) {
            return;
        }
        for (const stronghold of this.strongholdViews.values()) {
            stronghold.refreshLayout(this.canvas, HUD_HEIGHT);
        }
    }

    private bindStrongholds(): void {
        if (!this.canvas) {
            return;
        }
        for (const link of STRONGHOLD_LINKS) {
            const view = new StrongholdView(
                this.requireDescendant(this.canvas, link.bodyName),
                this.requireDescendant(this.canvas, link.infoName),
                link.id,
                (id) => this.handleStrongholdClick(id),
            );
            this.strongholdViews.set(link.id, view);
        }
    }

    /** 名称和坐标以场景节点为准，避免用配置里的旧坐标。 */
    private applySceneFacts(): void {
        if (!this.canvas) {
            return;
        }
        for (const state of this.session.strongholds) {
            const view = this.strongholdViews.get(state.id);
            if (!view) {
                continue;
            }
            state.name = view.currentName || state.name;
            state.position = this.pointIn(this.canvas, view.body);
        }
    }

    private handleStrongholdClick(id: StrongholdId): void {
        if (this.session.result || this.session.paused) {
            this.showToast(this.session.result ? GameText.gameEnded : GameText.gamePaused);
            return;
        }
        const view = this.strongholdViews.get(id);
        if (this.session.phase === GamePhase.Marching || this.session.phase === GamePhase.Battling) {
            const result = onStrongholdClick(this.session, id);
            this.showToast(result.toast);
            this.renderAll();
            return;
        }
        view?.playPress();
        const result = onStrongholdClick(this.session, id);
        this.showToast(result.toast);
        this.renderAll();
    }

    private handleAmountChange(delta: 1 | -1): void {
        const result = changeDispatchAmount(this.session, delta);
        this.showToast(result.toast);
        this.renderHud();
    }

    private handleRecruit(): void {
        const result = tryRecruit(this.session);
        this.showToast(result.toast);
        this.renderAll();
        this.checkGameEnd();
    }

    private handleDispatch(): void {
        const result = tryDispatch(this.session);
        if (!result.ok) {
            this.showToast(result.toast);
            return;
        }

        try {
            this.renderAll();
            this.createAndStartArmy();
        } finally {
            this.session.dispatchLock = false;
        }
    }

    private createAndStartArmy(): void {
        if (!this.canvas || !this.soldierPrefab || !this.session.army) {
            return;
        }
        const source = findStronghold(this.session, this.session.army.sourceId);
        const target = findStronghold(this.session, this.session.army.targetId);
        const sourceView = this.strongholdViews.get(this.session.army.sourceId);
        const targetView = this.strongholdViews.get(this.session.army.targetId);
        if (!source || !target || !sourceView || !targetView) {
            throw new Error('场景缺少出兵城或目标城');
        }

        const gate = this.findDescendant(this.canvas, 'ggb');
        const startNode = source.id === 'player_base' && gate ? gate : sourceView.body;
        const start = this.pointIn(this.canvas, startNode);
        const end = this.pointIn(this.canvas, targetView.body);
        this.armyView = ArmyView.createFrom(this.soldierPrefab, this.canvas, this.session.army.troops, start);
        this.keepBelowPanels(this.armyView.root);
        this.armyView.setStateText(GameText.marching);
        this.audio?.playWalk();
        this.armyView.playRoute([start, end], () => this.handleArmyArrived());
    }

    private handleArmyArrived(): void {
        const targetView = this.session.army
            ? this.strongholdViews.get(this.session.army.targetId)
            : undefined;
        this.audio?.stopWalk();
        const result = onArmyArrived(this.session);
        this.disposeArmyView();
        if (result.capturedImmediately) {
            this.clearSiegeFx();
            this.showToast(result.toast);
            this.renderAll();
            if (!this.checkGameEnd()) {
                this.audio?.playSiegeSucc();
            }
            return;
        }
        if (this.session.phase !== GamePhase.Battling) {
            return;
        }
        if (targetView) {
            this.showSiegeFx(targetView.body);
        }
        this.audio?.playBattle();
        this.renderAll();
        this.schedule(this.handleBattleTick, BATTLE_INTERVAL, macro.REPEAT_FOREVER, BATTLE_INTERVAL);
    }

    private handleBattleTick(): void {
        if (this.session.paused || this.session.result) {
            return;
        }
        const army = this.session.army;
        if (!army || !this.canvas) {
            this.unschedule(this.handleBattleTick);
            return;
        }
        const target = findStronghold(this.session, army.targetId);
        if (!target) {
            this.unschedule(this.handleBattleTick);
            return;
        }

        const result = applyBattleTick(this.session);
        if (!result) {
            return;
        }
        if (result.defenderLoss > 0) {
            this.floatNodes.push(showDamageFloat(
                this.canvas,
                target.position.x + DEFENDER_FLOAT_OFFSET.x,
                target.position.y + DEFENDER_FLOAT_OFFSET.y,
                `-${result.defenderLoss}`,
            ));
        }
        if (result.attackerLoss > 0) {
            this.floatNodes.push(showDamageFloat(
                this.canvas,
                target.position.x + ATTACKER_FLOAT_OFFSET.x,
                target.position.y + ATTACKER_FLOAT_OFFSET.y,
                `-${result.attackerLoss}`,
            ));
        }

        if (result.outcome === 'ongoing') {
            this.armyView?.setTroops(this.session.army?.troops ?? 0);
            this.renderAll();
            return;
        }

        this.unschedule(this.handleBattleTick);
        this.disposeArmyView();
        this.clearSiegeFx();
        this.audio?.stopBattle();
        this.showToast(result.toast);
        this.renderAll();
        if (!this.checkGameEnd()) {
            if (result.outcome === 'capture') {
                this.audio?.playSiegeSucc();
            } else {
                this.audio?.playSiegeFail();
            }
        }
    }

    private handleTimerTick(): void {
        if (this.session.result || this.session.paused) {
            return;
        }
        this.session.elapsedSeconds += 1;
        this.renderTimer();
    }

    private handlePauseToggle(): void {
        if (this.session.result) {
            this.showToast(GameText.gameEnded);
            return;
        }
        if (this.session.paused) {
            this.handleResumeFromPause();
            return;
        }
        this.pauseGame();
        this.pausePanel?.show(this.audio?.isEnabled() ?? true);
        this.renderAll();
    }

    private handleResumeFromPause(): void {
        this.pausePanel?.hide();
        this.resumeGame();
        this.renderAll();
    }

    private handleToggleMusic(): void {
        const next = !(this.audio?.isEnabled() ?? true);
        this.audio?.setEnabled(next);
        this.pausePanel?.setMusicEnabled(next);
    }

    private handleExitFromPause(): void {
        this.pausePanel?.hide();
        this.session.paused = false;
        this.session.result = 'lose';
        this.unschedule(this.handleBattleTick);
        this.battlePaused = false;
        this.armyView?.pause();
        this.siegeFx?.getComponent(Animation)?.pause();
        this.audio?.unmuteAfterPause();
        this.audio?.playFail();
        this.endPanel?.show('lose', this.session.elapsedSeconds);
        this.renderAll();
    }

    private pauseGame(): void {
        this.session.paused = true;
        this.armyView?.pause();
        this.siegeFx?.getComponent(Animation)?.pause();
        this.audio?.muteForPause();
        if (this.session.phase === GamePhase.Battling) {
            this.unschedule(this.handleBattleTick);
            this.battlePaused = true;
        }
    }

    private resumeGame(): void {
        this.session.paused = false;
        this.armyView?.resume();
        this.siegeFx?.getComponent(Animation)?.resume();
        this.audio?.unmuteAfterPause();
        if (this.battlePaused && this.session.phase === GamePhase.Battling && this.session.army) {
            this.schedule(this.handleBattleTick, BATTLE_INTERVAL, macro.REPEAT_FOREVER, BATTLE_INTERVAL);
        }
        this.battlePaused = false;
    }

    /** 已终局返回 true，否则 false。 */
    private checkGameEnd(): boolean {
        const result = evaluateEnd(this.session);
        if (!result) {
            return false;
        }
        this.pausePanel?.hide();
        this.unschedule(this.handleBattleTick);
        this.battlePaused = false;
        this.armyView?.pause();
        this.siegeFx?.getComponent(Animation)?.pause();
        this.audio?.stopBattle();
        this.audio?.stopWalk();
        if (result === 'win') {
            this.audio?.playSucc();
        } else {
            this.audio?.playFail();
        }
        this.endPanel?.show(result, this.session.elapsedSeconds);
        this.renderPauseButton();
        this.renderTimer();
        this.renderHud();
        return true;
    }

    private handleRestart(): void {
        this.unschedule(this.handleBattleTick);
        this.battlePaused = false;
        this.disposeArmyView();
        this.clearSiegeFx();
        this.clearDamageFloats();
        this.hud?.clearToast();
        this.pausePanel?.hide();
        this.endPanel?.hide();
        this.audio?.stopAll();
        for (const view of this.strongholdViews.values()) {
            view.resetVisual();
        }
        this.session = createSession();
        this.applySceneFacts();
        this.audio?.playBgm();
        this.renderAll();
    }

    private renderAll(): void {
        for (const state of this.session.strongholds) {
            const view = this.strongholdViews.get(state.id);
            view?.render(state);
            view?.setSourceHighlight(this.session.sourceId === state.id);
            view?.setTargetHighlight(this.session.targetId === state.id);
            view?.setFocused(this.session.focusId === state.id);
        }
        this.renderHud();
    }

    private renderHud(): void {
        if (!this.hud) {
            return;
        }
        const source = this.session.sourceId ? findStronghold(this.session, this.session.sourceId) : null;
        const target = this.session.targetId ? findStronghold(this.session, this.session.targetId) : null;
        this.hud.setSourceText(source ? this.formatStronghold(source.name, source.faction) : GameText.unselected);
        this.hud.setTargetText(target ? this.formatStronghold(target.name, target.faction) : GameText.unselected);
        this.hud.setAvailableText(source ? `${source.troops}/${TROOP_CAP[source.id]}` : '0/0');
        this.hud.setGrainText(String(this.session.grain));
        this.hud.setDispatchText(this.session.dispatchText);
        this.hud.setStatusText(getStatusText(this.session));
        this.renderTimer();
        this.renderPauseButton();
    }

    private bindTimerAndPause(): void {
        if (!this.canvas) {
            return;
        }
        this.timerLabel = this.requireDescendant(this.canvas, 'Timer').getComponent(Label);
        if (!this.timerLabel) {
            throw new Error('Timer 缺少 Label');
        }
        this.pauseButton = this.requireDescendant(this.canvas, 'Pause');
        if (!this.pauseButton.getComponent(Button)) {
            throw new Error('Pause 缺少 Button');
        }
        this.pauseLabel = this.requireChildLabel(this.pauseButton, 'Label');
        this.pauseButton.on(Button.EventType.CLICK, this.handlePauseToggle, this);
        this.renderTimer();
        this.renderPauseButton();
    }

    private renderTimer(): void {
        if (!this.timerLabel) {
            return;
        }
        this.timerLabel.string = `${GameText.timePrefix} ${formatElapsed(this.session.elapsedSeconds)}`;
    }

    private renderPauseButton(): void {
        if (!this.pauseLabel) {
            return;
        }
        this.pauseLabel.string = this.session.paused ? GameText.resume : GameText.pause;
        if (this.pauseButton) {
            this.pauseButton.active = this.session.result === null;
        }
    }

    private requireChildLabel(parent: Node, name: string): Label {
        const child = parent.getChildByName(name);
        const label = child?.getComponent(Label);
        if (!label) {
            throw new Error(`${parent.name} 缺少 ${name} Label`);
        }
        return label;
    }

    private formatStronghold(name: string, faction: keyof typeof FACTION_LABEL): string {
        return `${name}（${FACTION_LABEL[faction]}）`;
    }

    private showToast(text: string | null): void {
        if (text) {
            this.hud?.showToast(text);
        }
    }

    private disposeArmyView(): void {
        this.armyView?.dispose();
        this.armyView = null;
    }

    /** 士兵已经消失。攻城动画挂在 Canvas 下，位置取目标城当前坐标。 */
    private showSiegeFx(targetBody: Node): void {
        if (!this.canvas || !this.siegeFxPrefab) {
            return;
        }
        this.clearSiegeFx();
        const point = this.pointIn(this.canvas, targetBody);
        const node = instantiate(this.siegeFxPrefab);
        node.layer = this.canvas.layer;
        node.setParent(this.canvas);
        const bodyHeight = (targetBody.getComponent(UITransform)?.height ?? 0) * Math.abs(targetBody.scale.y);
        const fxHeight = (node.getComponent(UITransform)?.height ?? 0) * Math.abs(node.scale.y);
        node.setPosition(point.x, point.y + bodyHeight * 0.45 + fxHeight * 0.15, 0);
        this.keepBelowPanels(node);
        node.getComponent(Animation)?.play();
        this.siegeFx = node;
    }

    private keepBelowPanels(node: Node): void {
        if (!this.canvas || node.parent !== this.canvas) {
            return;
        }
        const indexes = ['Hud', 'Toast', 'PausePanel', 'ClearPanel']
            .map((name) => this.findDescendant(this.canvas!, name))
            .filter((item): item is Node => item?.parent === this.canvas)
            .map((item) => item.getSiblingIndex());
        if (indexes.length > 0) {
            node.setSiblingIndex(Math.min(...indexes));
        }
    }

    private clearSiegeFx(): void {
        if (this.siegeFx?.isValid) {
            this.siegeFx.getComponent(Animation)?.stop();
            this.siegeFx.destroy();
        }
        this.siegeFx = null;
    }

    private clearDamageFloats(): void {
        for (const node of this.floatNodes) {
            if (node.isValid) {
                Tween.stopAllByTarget(node);
                node.destroy();
            }
        }
        this.floatNodes.length = 0;
    }

    private releaseBindings(): void {
        view.off('canvas-resize', this.handleCanvasResize, this);
        this.unschedule(this.refreshResponsiveLayout);
        this.unschedule(this.handleTimerTick);
        this.unschedule(this.handleBattleTick);
        this.pauseButton?.off(Button.EventType.CLICK, this.handlePauseToggle, this);
        this.pauseButton = null;
        this.pauseLabel = null;
        this.timerLabel = null;
        this.battlePaused = false;
        this.disposeArmyView();
        this.clearSiegeFx();
        this.clearDamageFloats();
        for (const view of this.strongholdViews.values()) {
            view.dispose();
        }
        this.strongholdViews.clear();
        this.pausePanel?.dispose();
        this.pausePanel = null;
        this.endPanel?.dispose();
        this.endPanel = null;
        this.audio?.stopAll();
        this.audio = null;
        this.hud?.dispose();
        this.hud = null;
        this.canvas = null;
        this.resolutionPolicy = null;
        this.initialized = false;
    }

    private pointIn(parent: Node, target: Node): Vec2 {
        const point = new Vec3();
        parent.inverseTransformPoint(point, target.worldPosition);
        return { x: point.x, y: point.y };
    }

    private findDescendant(root: Node, name: string): Node | null {
        if (root.name === name) {
            return root;
        }
        for (const child of root.children) {
            const found = this.findDescendant(child, name);
            if (found) {
                return found;
            }
        }
        return null;
    }

    private requireDescendant(root: Node, name: string): Node {
        const current = this.findDescendant(root, name);
        if (!current) {
            throw new Error(`场景缺少节点 ${name}`);
        }
        return current;
    }
}
