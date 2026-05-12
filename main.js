"use strict";

const { Menu, Notice, Plugin, PluginSettingTab, Setting, TFile } = require("obsidian");

const MAX_RECENT_TAGS = 100;
const MAX_SUGGESTIONS = 40;
const TAGS_PER_PAGE = 5;
const DEFAULT_DATA = {
	allowMultipleTags: true,
	recentTags: []
};
const MENU_SECTION = "file-tag-picker";

class FileTagPickerPlugin extends Plugin {
	async onload() {
		this.menusWithTagSection = new WeakSet();
		this.tagPageIndex = 0;
		const loadedData = await this.loadData();
		this.data = Object.assign({}, DEFAULT_DATA, loadedData ?? {});
		if (!Array.isArray(this.data.recentTags)) {
			this.data.recentTags = [];
		}
		if (typeof this.data.allowMultipleTags !== "boolean") {
			this.data.allowMultipleTags = DEFAULT_DATA.allowMultipleTags;
		}

		this.addSettingTab(new FileTagPickerSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				const files = this.getMarkdownFiles([file]);
				this.tagPageIndex = 0;
				this.addTagMenu(menu, files, { standaloneMenu: false });
			})
		);

		this.registerEvent(
			this.app.workspace.on("files-menu", (menu, files) => {
				this.tagPageIndex = 0;
				this.addTagMenu(menu, this.getMarkdownFiles(files), { standaloneMenu: false });
			})
		);
	}

	addTagMenu(menu, files, options) {
		const standaloneMenu = Boolean(options?.standaloneMenu);
		if (!Array.isArray(files) || files.length === 0) {
			return;
		}
		if (!standaloneMenu) {
			if (this.menusWithTagSection.has(menu)) {
				return;
			}
			this.menusWithTagSection.add(menu);
		}

		const statusByTag = this.getSelectionTagStatus(files);
		const rankedSuggestions = this.getRankedSuggestions(statusByTag);
		const pageCount = Math.max(1, Math.ceil(rankedSuggestions.length / TAGS_PER_PAGE));
		const normalizedPageIndex = this.tagPageIndex % pageCount;
		const startIndex = normalizedPageIndex * TAGS_PER_PAGE;
		const visibleTags = rankedSuggestions.slice(startIndex, startIndex + TAGS_PER_PAGE);
		const pageLabelStart = rankedSuggestions.length === 0 ? 0 : startIndex + 1;
		const pageLabelEnd = startIndex + visibleTags.length;

		if (!standaloneMenu) {
			menu.addSeparator();
		}
		menu.addItem((item) => {
			item.setTitle("Tags").setIcon("tags").setIsLabel(true).setSection(MENU_SECTION);
		});
		menu.addItem((item) => {
			item
				.setTitle(files.length === 1 ? "Apply to this file" : `Apply to ${files.length} files`)
				.setIsLabel(true)
				.setSection(MENU_SECTION);
		});
		menu.addItem((item) => {
			item
				.setTitle(
					rankedSuggestions.length === 0
						? "No tags available"
						: `Most recent and frequent (${pageLabelStart}-${pageLabelEnd} of ${rankedSuggestions.length})`
				)
				.setIsLabel(true)
				.setSection(MENU_SECTION);
		});

		for (const tag of visibleTags) {
			const status = statusByTag.get(tag);
			const count = status?.count ?? 0;
			const checked = count === files.length ? true : count > 0 ? null : false;
			const suffix = count > 0 && count < files.length ? " (some)" : "";
			menu.addItem((item) => {
				item
					.setTitle(`#${tag}${suffix}`)
					.setChecked(checked)
					.setSection(MENU_SECTION)
					.onClick(() => {
						void this.toggleTagForFiles(files, tag, count === files.length);
					});
			});
		}

		if (rankedSuggestions.length > TAGS_PER_PAGE) {
			menu.addItem((item) => {
				item
					.setTitle("▶ Show next 5 tags")
					.setSection(MENU_SECTION)
					.onClick((event) => {
						this.tagPageIndex = (normalizedPageIndex + 1) % pageCount;
						this.openStandaloneTagMenu(files, event);
					});
			});
			menu.addItem((item) => {
				item
					.setTitle("◀ Show previous 5 tags")
					.setSection(MENU_SECTION)
					.onClick((event) => {
						this.tagPageIndex = (normalizedPageIndex - 1 + pageCount) % pageCount;
						this.openStandaloneTagMenu(files, event);
					});
			});
		}

		if (rankedSuggestions.length === 0) {
			const currentTags = Array.from(statusByTag.keys()).sort((a, b) => a.localeCompare(b));
			for (const tag of currentTags) {
				const status = statusByTag.get(tag);
				const checked = status.count === files.length ? true : null;
				const suffix = status.count === files.length ? "" : " (some)";
				menu.addItem((item) => {
					item
						.setTitle(`#${tag}${suffix}`)
						.setChecked(checked)
						.setSection(MENU_SECTION)
						.onClick(() => {
							void this.toggleTagForFiles(files, tag, status.count === files.length);
						});
				});
			}
		}

		menu.addItem((item) => {
			item
				.setTitle("Clear tags")
				.setWarning(true)
				.setSection(MENU_SECTION)
				.onClick(() => {
					void this.clearTagsForFiles(files);
				});
		});

	}

	openStandaloneTagMenu(files, event) {
		const menu = new Menu();
		this.addTagMenu(menu, files, { standaloneMenu: true });

		if (
			event &&
			typeof event.pageX === "number" &&
			typeof event.pageY === "number"
		) {
			menu.showAtPosition({ x: event.pageX, y: event.pageY }, event.doc);
			return;
		}

		new Notice("Right-click again to browse more tags.");
	}

	getMarkdownFiles(files) {
		if (!Array.isArray(files)) {
			return [];
		}
		return files.filter((file) => file instanceof TFile && file.extension === "md");
	}

	getSelectionTagStatus(files) {
		const statusByTag = new Map();
		for (const file of files) {
			const tags = this.getCurrentTags(file);
			for (const tag of tags) {
				const existing = statusByTag.get(tag);
				if (existing) {
					existing.count += 1;
				} else {
					statusByTag.set(tag, { count: 1 });
				}
			}
		}
		return statusByTag;
	}

	async toggleTagForFiles(files, tag, removeEverywhere) {
		const normalizedTag = this.normalizeTag(tag);
		if (!normalizedTag) {
			return;
		}

		if (!this.data.allowMultipleTags) {
			await this.setSingleTagForFiles(files, normalizedTag);
			return;
		}

		for (const file of files) {
			const currentTags = this.getCurrentTags(file);
			const nextTags = new Set(currentTags);
			if (removeEverywhere) {
				nextTags.delete(normalizedTag);
			} else {
				nextTags.add(normalizedTag);
			}
			await this.setFileTags(file, Array.from(nextTags));
		}

		await this.recordRecentTags([normalizedTag]);
		const actionText = removeEverywhere ? "Removed" : "Added";
		new Notice(
			files.length === 1
				? `${actionText} #${normalizedTag}.`
				: `${actionText} #${normalizedTag} in ${files.length} files.`
		);
	}

	async setSingleTagForFiles(files, tag) {
		for (const file of files) {
			await this.setFileTags(file, [tag]);
		}

		await this.recordRecentTags([tag]);
		new Notice(
			files.length === 1
				? `Set tag to #${tag}.`
				: `Set tag to #${tag} in ${files.length} files.`
		);
	}

	async clearTagsForFiles(files) {
		for (const file of files) {
			await this.setFileTags(file, []);
		}
		new Notice(files.length === 1 ? "Cleared tags." : `Cleared tags in ${files.length} files.`);
	}

	getRankedSuggestions(statusByTag) {
		const ranked = [];
		const seen = new Set();

		const addCandidate = (candidate) => {
			const tag = this.normalizeTag(candidate);
			if (!tag || seen.has(tag)) {
				return;
			}
			seen.add(tag);
			ranked.push(tag);
		};

		for (const tag of this.data.recentTags) {
			addCandidate(tag);
		}

		for (const tag of this.getVaultTagsByFrequency()) {
			addCandidate(tag);
		}

		if (statusByTag instanceof Map) {
			const currentTags = Array.from(statusByTag.keys()).sort((a, b) => a.localeCompare(b));
			for (const tag of currentTags) {
				addCandidate(tag);
			}
		}

		return ranked.slice(0, MAX_SUGGESTIONS);
	}

	normalizeTag(tag) {
		if (typeof tag !== "string") {
			return "";
		}

		return tag.trim().replace(/^#+/, "");
	}

	parseTagList(input) {
		if (typeof input !== "string") {
			return [];
		}

		return input
			.split(/[\n,]/)
			.map((tag) => this.normalizeTag(tag))
			.filter(Boolean);
	}

	getCurrentTags(file) {
		const fileCache = this.app.metadataCache.getFileCache(file);
		const frontmatter = fileCache?.frontmatter;
		if (!frontmatter) {
			return [];
		}

		const source = frontmatter.tags ?? frontmatter.tag;
		const rawTags = [];

		if (Array.isArray(source)) {
			rawTags.push(...source);
		} else if (typeof source === "string") {
			rawTags.push(...this.parseTagList(source));
		}

		const dedupedTags = [];
		const seen = new Set();

		for (const rawTag of rawTags) {
			const tag = this.normalizeTag(String(rawTag));
			if (!tag || seen.has(tag)) {
				continue;
			}
			seen.add(tag);
			dedupedTags.push(tag);
		}

		return dedupedTags;
	}

	getVaultTagsByFrequency() {
		const tags = this.app.metadataCache.getTags() ?? {};
		return Object.entries(tags)
			.map(([name, count]) => ({
				name: this.normalizeTag(name),
				count
			}))
			.filter((tag) => tag.name.length > 0)
			.sort((a, b) => {
				if (b.count !== a.count) {
					return b.count - a.count;
				}
				return a.name.localeCompare(b.name);
			})
			.map((tag) => tag.name);
	}

	async setFileTags(file, tags) {
		const normalizedTags = [];
		const seen = new Set();

		for (const rawTag of tags) {
			const tag = this.normalizeTag(rawTag);
			if (!tag || seen.has(tag)) {
				continue;
			}
			seen.add(tag);
			normalizedTags.push(tag);
		}

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			if (normalizedTags.length === 0) {
				delete frontmatter.tags;
				delete frontmatter.tag;
				return;
			}

			frontmatter.tags = normalizedTags;
			delete frontmatter.tag;
		});
	}

	async recordRecentTags(tags) {
		const normalized = [];
		const seen = new Set();

		for (const rawTag of tags) {
			const tag = this.normalizeTag(rawTag);
			if (!tag || seen.has(tag)) {
				continue;
			}
			seen.add(tag);
			normalized.push(tag);
		}

		const merged = [...normalized, ...this.data.recentTags.filter((tag) => !seen.has(tag))];
		this.data.recentTags = merged.slice(0, MAX_RECENT_TAGS);
		await this.saveData(this.data);
	}
}

class FileTagPickerSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Allow multiple tags")
			.setDesc("When off, choosing a tag from the file menu replaces the file's existing tags.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.data.allowMultipleTags)
					.onChange(async (value) => {
						this.plugin.data.allowMultipleTags = value;
						await this.plugin.saveData(this.plugin.data);
					});
			});
	}
}

module.exports = FileTagPickerPlugin;
