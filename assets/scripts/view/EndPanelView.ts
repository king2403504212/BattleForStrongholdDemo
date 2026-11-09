import { Button, Label, Node } from 'cc';
import { GameText } from '../config/GameConfig';
import { formatElapsed, getClearRank } from '../model/StrongholdState';
import { GameResult } from '../types/GameTypes';

/**
 * 绑定场景里的 ClearPanel。
 * 只改显示和重开点击，不创建面板节点。
 */
export class EndPanelView {
    private readonly root: Node;
    private readonly title: Label;
    private readonly timeValue: Label;
    private readonly rankValue: Label;
    private readonly onRestart: () => void;

    constructor(root: Node, onRestart: () => void) {
        this.root = root;
        this.onRestart = onRestart;
        this.title = this.requireLabel(root, 'Title');
        this.timeValue = this.requireLabel(root, 'TimeValue');
        this.rankValue = this.requireLabel(root, 'RankValue');
        this.bindButton(root, 'ClearRestart', this.handleRestart);
        this.hide();
    }

    show(result: GameResult, elapsedSeconds: number): void {
        this.root.active = true;
        this.root.setSiblingIndex(this.root.parent ? this.root.parent.children.length - 1 : 0);
        if (result === 'win') {
            this.title.string = GameText.clearWin;
            this.timeValue.string = `${GameText.usedTimePrefix} ${formatElapsed(elapsedSeconds)}`;
            this.rankValue.string = `${GameText.rankPrefix} ${getClearRank(elapsedSeconds)}`;
            this.rankValue.node.active = true;
            return;
        }
        this.title.string = GameText.clearLose;
        this.timeValue.string = `${GameText.usedTimePrefix} ${formatElapsed(elapsedSeconds)}`;
        this.rankValue.string = '';
        this.rankValue.node.active = false;
    }

    hide(): void {
        this.root.active = false;
    }

    dispose(): void {
        this.hide();
        this.offButton(this.root, 'ClearRestart', this.handleRestart);
    }

    private handleRestart(): void {
        this.onRestart();
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

    private requireChild(parent: Node, name: string): Node {
        const child = parent.getChildByName(name);
        if (!child) {
            throw new Error(`${parent.name} 缺少 ${name}`);
        }
        return child;
    }

    private requireLabel(parent: Node, name: string): Label {
        const label = this.requireChild(parent, name).getComponent(Label);
        if (!label) {
            throw new Error(`${parent.name}/${name} 缺少 Label`);
        }
        return label;
    }
}
