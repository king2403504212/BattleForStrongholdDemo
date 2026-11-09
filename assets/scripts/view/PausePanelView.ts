import { Button, Label, Node } from 'cc';
import { GameText } from '../config/GameConfig';

export interface PausePanelHandlers {
    onToggleMusic: () => void;
    onExit: () => void;
    onRestart: () => void;
    onResume: () => void;
}

/**
 * 绑定场景里的 PausePanel。
 * 只改显示和按钮回调，不创建面板节点。
 */
export class PausePanelView {
    private readonly root: Node;
    private readonly musicLabel: Label;
    private readonly handlers: PausePanelHandlers;

    constructor(root: Node, handlers: PausePanelHandlers) {
        this.root = root;
        this.handlers = handlers;
        this.requireNodeLabel(this.requireChild(root, 'Title')).string = GameText.pauseTitle;
        this.musicLabel = this.requireButtonLabel(root, 'MusicToggle');
        this.requireButtonLabel(root, 'ExitGame').string = GameText.exitGame;
        this.requireButtonLabel(root, 'PauseRestart').string = GameText.restart;
        this.requireButtonLabel(root, 'Resume').string = GameText.resume;
        this.bindButton(root, 'MusicToggle', this.onMusic);
        this.bindButton(root, 'ExitGame', this.onExit);
        this.bindButton(root, 'PauseRestart', this.onRestart);
        this.bindButton(root, 'Resume', this.onResume);
        this.hide();
    }

    show(musicEnabled: boolean): void {
        this.root.active = true;
        this.root.setSiblingIndex(this.root.parent ? this.root.parent.children.length - 1 : 0);
        this.setMusicEnabled(musicEnabled);
    }

    hide(): void {
        this.root.active = false;
    }

    setMusicEnabled(enabled: boolean): void {
        this.musicLabel.string = enabled ? GameText.musicOff : GameText.musicOn;
    }

    dispose(): void {
        this.hide();
        this.offButton(this.root, 'MusicToggle', this.onMusic);
        this.offButton(this.root, 'ExitGame', this.onExit);
        this.offButton(this.root, 'PauseRestart', this.onRestart);
        this.offButton(this.root, 'Resume', this.onResume);
    }

    private onMusic(): void {
        this.handlers.onToggleMusic();
    }

    private onExit(): void {
        this.handlers.onExit();
    }

    private onRestart(): void {
        this.handlers.onRestart();
    }

    private onResume(): void {
        this.handlers.onResume();
    }

    private bindButton(parent: Node, name: string, handler: () => void): void {
        const node = this.requireChild(parent, name);
        if (!node.getComponent(Button)) {
            throw new Error(`${parent.name}/${name} 缺少 Button`);
        }
        node.on(Button.EventType.CLICK, handler, this);
    }

    private offButton(parent: Node, name: string, handler: () => void): void {
        parent.getChildByName(name)?.off(Button.EventType.CLICK, handler, this);
    }

    private requireButtonLabel(parent: Node, buttonName: string): Label {
        return this.requireNodeLabel(this.requireChild(this.requireChild(parent, buttonName), 'Label'));
    }

    private requireChild(parent: Node, name: string): Node {
        const child = parent.getChildByName(name);
        if (!child) {
            throw new Error(`${parent.name} 缺少 ${name}`);
        }
        return child;
    }

    private requireNodeLabel(node: Node): Label {
        const label = node.getComponent(Label);
        if (!label) {
            throw new Error(`${node.name} 缺少 Label`);
        }
        return label;
    }
}
