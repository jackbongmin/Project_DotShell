package com.dotshell.engine.container;

/**
 * 디렉터리 안의 항목 하나. 도트 화면에서는 kind에 따라 문(dir)이나 두루마리(file)로 그린다.
 *
 * @param name   이름
 * @param kind   dir, file, link, other
 * @param hidden 이름이 '.'으로 시작하는 숨김 항목인지
 */
public record DirectoryEntry(String name, String kind, boolean hidden) {

	static DirectoryEntry fromFindLine(String line) {
		int tab = line.indexOf('\t');
		if (tab <= 0) {
			return null;
		}
		String name = line.substring(tab + 1);
		String kind = switch (line.charAt(0)) {
			case 'd' -> "dir";
			case 'f' -> "file";
			case 'l' -> "link";
			default -> "other";
		};
		return new DirectoryEntry(name, kind, name.startsWith("."));
	}
}
