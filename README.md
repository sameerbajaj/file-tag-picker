# File tag picker

Manage frontmatter tags directly from the Obsidian file explorer context menu.

## Features

- Right-click one file or a multi-file selection in the file explorer and edit tags inline.
- Toggle tags with check states:
  - checked = present in all selected files
  - mixed = present in some selected files
  - unchecked = not present
- Ranked tags with recency first, then vault frequency.
- Paged menu: five tags at a time with next/previous controls.
- Bulk clear tags for all selected files.

## How it works

The plugin updates YAML frontmatter `tags` in each selected Markdown file by using Obsidian's `processFrontMatter` API.

## Install (manual)

1. Copy `manifest.json`, `main.js`, and `styles.css` to:
   `.obsidian/plugins/file-tag-picker/`
2. Reload Obsidian.
3. Enable **File tag picker** in **Settings → Community plugins**.

## Usage

1. Select one or more Markdown notes in the file explorer.
2. Right-click and use the **Tags** section in the menu.
3. Click a tag to add/remove it across the selection.
4. Use **▶ Show next 5 tags** and **◀ Show previous 5 tags** to page through more tags.

## License

MIT
