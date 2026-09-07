// Runtime stand-in for the types-only `obsidian` package. Records what was asked for;
// invents no behavior. Extend only when src/ uses new API surface.

export interface Command {
	id: string;
	name: string;
	callback?: () => void | Promise<void>;
	checkCallback?: (checking: boolean) => boolean;
}

export interface WorkspaceLeaf {
	view: unknown;
	setViewState(state: { type: string; active?: boolean }): Promise<void>;
}

export const apiVersion = '1.13.0';
export const Platform = { isDesktop: true, isMobile: false };

export class Notice {
	static shown: string[] = [];
	constructor(message: string) {
		Notice.shown.push(message);
	}
}

export function setIcon(el: HTMLElement, icon: string): void {
	el.dataset.icon = icon;
}

export class FileSystemAdapter {
	constructor(private readonly basePath: string) {}
	getBasePath(): string {
		return this.basePath;
	}
}

export interface EventRef {
	name: string;
	cb: (...args: never[]) => void;
}

type Listener = (...args: never[]) => void;

export class App {
	vault = {
		adapter: new FileSystemAdapter('C:/fake-vault') as unknown,
		handlers: {} as Record<string, (() => void)[]>,
		files: new Map<string, { path: string }>(),
		on(name: string, cb: () => void): EventRef {
			(this.handlers[name] ??= []).push(cb);
			return { name, cb };
		},
		trigger(name: string): void {
			for (const cb of this.handlers[name] ?? []) cb();
		},
		getFileByPath(path: string): { path: string } | null {
			return this.files.get(path) ?? null;
		},
	};
	workspace = {
		leaves: [] as WorkspaceLeaf[],
		opened: [] as string[],
		layoutReady: false,
		handlers: {} as Record<string, Listener[]>,
		activeFile: null as { path: string } | null,
		onLayoutReady(cb: () => void): void {
			cb();
		},
		on(name: string, cb: Listener): EventRef {
			(this.handlers[name] ??= []).push(cb);
			return { name, cb };
		},
		trigger(name: string, ...args: unknown[]): void {
			for (const cb of this.handlers[name] ?? []) (cb as (...a: unknown[]) => void)(...args);
		},
		getActiveFile(): { path: string } | null {
			return this.activeFile;
		},
		getLeavesOfType(_type: string): WorkspaceLeaf[] {
			return this.leaves;
		},
		getRightLeaf(_split: boolean): WorkspaceLeaf {
			const leaf: WorkspaceLeaf = {
				view: null,
				setViewState: () => Promise.resolve(),
			};
			this.leaves.push(leaf);
			return leaf;
		},
		revealLeaf(_leaf: WorkspaceLeaf): Promise<void> {
			return Promise.resolve();
		},
		getLeaf(_newLeaf?: boolean): { openFile: (f: { path: string }) => Promise<void> } {
			const opened = this.opened;
			return {
				openFile(f: { path: string }): Promise<void> {
					opened.push(f.path);
					return Promise.resolve();
				},
			};
		},
	};
}

type ViewFactory = (leaf: WorkspaceLeaf) => unknown;

export class Plugin {
	readonly views = new Map<string, ViewFactory>();
	readonly ribbon: { icon: string; title: string; click: () => void }[] = [];
	readonly commands: Command[] = [];
	readonly settingTabs: PluginSettingTab[] = [];
	readonly saved: unknown[] = [];
	readonly registeredEvents: EventRef[] = [];
	data: unknown = null;

	constructor(
		readonly app: App,
		readonly manifest: Record<string, unknown> = {},
	) {}

	loadData(): Promise<unknown> {
		return Promise.resolve(this.data);
	}
	saveData(data: unknown): Promise<void> {
		this.saved.push(structuredClone(data));
		return Promise.resolve();
	}
	addSettingTab(tab: PluginSettingTab): void {
		this.settingTabs.push(tab);
	}
	registerView(type: string, factory: ViewFactory): void {
		this.views.set(type, factory);
	}
	addRibbonIcon(icon: string, title: string, click: () => void): HTMLElement {
		this.ribbon.push({ icon, title, click });
		return document.createElement('div');
	}
	addCommand(command: Command): Command {
		this.commands.push(command);
		return command;
	}
	register(_cb: () => void): void {}
	registerEvent(ref: EventRef): void {
		this.registeredEvents.push(ref);
	}
}

export class ItemView {
	readonly contentEl: HTMLElement & { empty(): void; createDiv(cls?: string): HTMLDivElement };
	readonly containerEl: HTMLElement;
	readonly app: App;

	constructor(readonly leaf: WorkspaceLeaf) {
		this.containerEl = document.createElement('div');
		this.contentEl = document.createElement('div') as HTMLElement & { empty(): void; createDiv(cls?: string): HTMLDivElement };
		this.contentEl.classList.add('view-content');
		this.containerEl.appendChild(this.contentEl);
		this.app = new App();
		Object.assign(this.contentEl, {
			empty() {
				(this as HTMLElement).replaceChildren();
			},
			createDiv(cls?: string) {
				const d = document.createElement('div');
				if (cls) d.className = cls;
				(this as HTMLElement).appendChild(d);
				return d;
			},
		});
	}
	getViewType(): string {
		throw new Error('ItemView.getViewType must be implemented by a subclass');
	}
}

// Fluent settings builder that records each control's wiring so a test can drive it.
export class Setting {
	name = '';
	desc = '';
	controls: { kind: 'text' | 'dropdown' | 'toggle'; value: unknown; onChange: (v: never) => unknown }[] = [];

	constructor(readonly containerEl: HTMLElement) {}

	setName(name: string): this {
		this.name = name;
		return this;
	}
	setDesc(desc: string): this {
		this.desc = desc;
		return this;
	}
	addText(cb: (t: TextComponent) => void): this {
		const t = new TextComponent();
		cb(t);
		this.controls.push({ kind: 'text', value: t.value, onChange: t.onChangeCb as (v: never) => unknown });
		return this;
	}
	addDropdown(cb: (d: DropdownComponent) => void): this {
		const d = new DropdownComponent();
		cb(d);
		this.controls.push({ kind: 'dropdown', value: d.value, onChange: d.onChangeCb as (v: never) => unknown });
		return this;
	}
	addToggle(cb: (t: ToggleComponent) => void): this {
		const t = new ToggleComponent();
		cb(t);
		this.controls.push({ kind: 'toggle', value: t.value, onChange: t.onChangeCb as (v: never) => unknown });
		return this;
	}
}

export class TextComponent {
	value = '';
	placeholder = '';
	onChangeCb: (v: string) => unknown = () => undefined;
	setValue(v: string): this {
		this.value = v;
		return this;
	}
	setPlaceholder(p: string): this {
		this.placeholder = p;
		return this;
	}
	onChange(cb: (v: string) => unknown): this {
		this.onChangeCb = cb;
		return this;
	}
}

export class DropdownComponent {
	value = '';
	options: Record<string, string> = {};
	onChangeCb: (v: string) => unknown = () => undefined;
	addOption(key: string, label: string): this {
		this.options[key] = label;
		return this;
	}
	addOptions(o: Record<string, string>): this {
		Object.assign(this.options, o);
		return this;
	}
	setValue(v: string): this {
		this.value = v;
		return this;
	}
	onChange(cb: (v: string) => unknown): this {
		this.onChangeCb = cb;
		return this;
	}
}

export class ToggleComponent {
	value = false;
	onChangeCb: (v: boolean) => unknown = () => undefined;
	setValue(v: boolean): this {
		this.value = v;
		return this;
	}
	onChange(cb: (v: boolean) => unknown): this {
		this.onChangeCb = cb;
		return this;
	}
}

export class PluginSettingTab {
	containerEl: HTMLElement = document.createElement('div');
	settings: Setting[] = [];
	constructor(
		readonly app: App,
		readonly plugin: unknown,
	) {}
	display(): void {}
}
